import os
import re
import asyncio
from datetime import datetime, timezone
from uuid import uuid4

import requests
from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

load_dotenv("/opt/signoff/secrets/control.env")
load_dotenv()

AGENT_NAME = os.getenv("AGENT_NAME", "signoff")
AGENT_PORT = int(os.getenv("AGENT_PORT", "8001"))
AGENT_SEED_PHRASE = os.getenv("AGENT_SEED_PHRASE", "replace-with-a-long-unique-seed")
ORCHESTRATOR_URL = os.getenv("ORCHESTRATOR_URL", "http://localhost:8787")
POLL_INTERVAL_SEC = int(os.getenv("SIGNOFF_POLL_INTERVAL_SEC", "5"))
POLL_TIMEOUT_SEC = int(os.getenv("SIGNOFF_POLL_TIMEOUT_SEC", str(30 * 60)))

active_polls: set[str] = set()

agent = Agent(
    name=AGENT_NAME,
    seed=AGENT_SEED_PHRASE,
    port=AGENT_PORT,
    mailbox=True,
    publish_agent_details=True,
    readme_path="agentverse/README.md",
)

protocol = Protocol(spec=chat_protocol_spec)


def now():
    return datetime.now(timezone.utc)


def extract_text(message: ChatMessage) -> str:
    chunks = []
    for item in message.content:
        if isinstance(item, TextContent):
            chunks.append(item.text)
    return "\n".join(chunks).strip()


def text_message(text: str) -> ChatMessage:
    return ChatMessage(
        timestamp=now(),
        msg_id=uuid4(),
        content=[
            TextContent(type="text", text=text),
            EndSessionContent(type="end-session"),
        ],
    )


def format_criteria(job: dict) -> str:
    lines = []
    for criterion in job.get("criteria", []):
        lines.append(f"- {criterion['description']}")
    return "\n".join(lines)


def format_job_summary(job: dict) -> str:
    verification = job.get("artifacts", {}).get("verification") or {}
    verdict = job.get("verdict", {})
    evidence_lines = []
    evidence_by_id = {
        item.get("criterionId"): item for item in verification.get("criteria", [])
    }
    for criterion in job.get("criteria", []):
        evidence = evidence_by_id.get(criterion["id"], {})
        status = evidence.get("status", "pending")
        observed = evidence.get("observed") or evidence.get("error")
        suffix = f" — {observed}" if observed else ""
        evidence_lines.append(f"- {criterion['id']}: {status}{suffix}")

    outcome = verdict.get("outcome", "pending")
    status = job["status"]
    if outcome == "satisfied":
        opener = "Done. The accepted checks passed, so this is ready for review."
    elif outcome == "not_satisfied":
        opener = "I can’t sign off on this yet. The implementation ran, but one of the accepted checks failed."
    elif outcome == "verification_error":
        opener = "I can’t sign off on this yet. Verification did not produce reliable enough evidence."
    elif status in {"building", "verifying", "authorized"}:
        opener = "It’s in progress. I’ll keep the contract fixed and verify the finished commit before release."
    else:
        opener = "Here’s the latest on this Signoff job."

    return (
        f"{opener}\n\n"
        f"Job `{job['id']}` · `{status}`\n"
        f"Verdict: `{outcome}`\n"
        f"Payment: `{job['payment']['status']}`\n"
        f"Merge eligible: `{verdict.get('mergeEligible', False)}`\n"
        f"Payment eligible: `{verdict.get('paymentEligible', False)}`\n\n"
        f"PR: {job['artifacts'].get('pullRequestUrl', 'pending')}\n"
        f"Proof: {job['artifacts']['proofPageUrl']}\n"
        f"Browser replay: {job['artifacts'].get('browserbaseReplayUrl', 'pending')}\n\n"
        "Checks:\n"
        + ("\n".join(evidence_lines) if evidence_lines else "Not run yet.")
    )


def extract_job_id(goal: str) -> str | None:
    match = re.search(r"\b[A-Za-z0-9_-]{8,14}\b", goal)
    return match.group(0) if match else None


def is_greeting(goal: str) -> bool:
    normalized = re.sub(r"[^\w\s]", "", goal.lower()).strip()
    if not normalized:
        return True
    greetings = {
        "hi",
        "hello",
        "hey",
        "yo",
        "hiya",
        "howdy",
        "sup",
        "gm",
        "good morning",
        "good afternoon",
        "good evening",
    }
    return normalized in greetings or normalized.startswith(("hi ", "hello ", "hey "))


def fetch_job(job_id: str) -> dict:
    response = requests.get(f"{ORCHESTRATOR_URL}/jobs/{job_id}", timeout=30)
    response.raise_for_status()
    return response.json()


def sync_job_payment(job_id: str) -> dict | None:
    try:
        response = requests.post(f"{ORCHESTRATOR_URL}/jobs/{job_id}/payment/sync", timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception:
        return None


async def poll_job_updates(ctx: Context, sender: str, job_id: str):
    if job_id in active_polls:
        return
    active_polls.add(job_id)
    notified_payment = False
    notified_status: str | None = None
    notified_repair_attempt = 0
    deadline = datetime.now(timezone.utc).timestamp() + POLL_TIMEOUT_SEC

    try:
        while datetime.now(timezone.utc).timestamp() < deadline:
            await asyncio.to_thread(sync_job_payment, job_id)
            try:
                job = await asyncio.to_thread(fetch_job, job_id)
            except Exception:
                await asyncio.sleep(POLL_INTERVAL_SEC)
                continue

            status = job["status"]
            payment = job["payment"]["status"]

            if payment == "authorized" and not notified_payment:
                notified_payment = True
                await ctx.send(
                    sender,
                    text_message(
                        "Payment authorized. I'm starting the executor under the frozen contract.\n\n"
                        f"Proof page: {job['artifacts']['proofPageUrl']}"
                    ),
                )

            repair_attempts = job.get("repairAttempts", 0)
            if (
                repair_attempts > notified_repair_attempt
                and status in {"building", "verifying"}
            ):
                notified_repair_attempt = repair_attempts
                reason = job.get("verdict", {}).get("reason", "One of the frozen checks failed.")
                await ctx.send(
                    sender,
                    text_message(
                        f"Attempt {repair_attempts} was not satisfied: {reason}\n\n"
                        f"I'm running repair attempt {repair_attempts + 1} under the same frozen contract.\n\n"
                        f"Job `{job_id}` · `{status}`"
                    ),
                )

            if status in {"building", "verifying"} and notified_status != status:
                notified_status = status
                phase = "Building" if status == "building" else "Verifying in Browserbase"
                await ctx.send(
                    sender,
                    text_message(
                        f"{phase}. I'll message you when the proof run finishes.\n\n"
                        f"Job `{job_id}` · `{status}`"
                    ),
                )

            if status in {"completed", "failed"}:
                await ctx.send(sender, text_message(format_job_summary(job)))
                return

            if payment in {"cancelled", "failed"} and status not in {"completed", "failed"}:
                await ctx.send(
                    sender,
                    text_message(
                        f"Stripe authorization did not complete (`{payment}`). "
                        f"You can reopen checkout from the proof page and try again.\n\n"
                        f"Proof: {job['artifacts']['proofPageUrl']}"
                    ),
                )
                return

            await asyncio.sleep(POLL_INTERVAL_SEC)
    finally:
        active_polls.discard(job_id)


@protocol.on_message(model=ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=now(), acknowledged_msg_id=msg.msg_id),
    )

    goal = extract_text(msg)
    if not goal:
        await ctx.send(
            sender,
            text_message(
                "Tell me the feature you want shipped, and I’ll turn it into a fixed completion contract.\n\n"
                "Example: “Make the Watchlist page work well on mobile while preserving the desktop table.”"
            ),
        )
        return

    lowered = goal.lower()
    job_id = extract_job_id(goal)
    ctx.logger.info("Received ASI chat from %s: %s", sender, goal[:240])

    if "approve" in lowered and job_id:
        try:
            response = requests.post(
                f"{ORCHESTRATOR_URL}/jobs/{job_id}/approve",
                json={"approvedBy": sender},
                timeout=30,
            )
            response.raise_for_status()
            job = response.json()
        except Exception as exc:
            await ctx.send(sender, text_message(f"I couldn’t approve that contract yet: {exc}"))
            return

        await ctx.send(
            sender,
            text_message(
                "Approved. I froze the contract, so the executor can’t change the checks later.\n\n"
                f"Contract hash: `{job.get('contractHash')}`\n"
                f"Payment link: {job['payment'].get('checkoutUrl', 'not configured')}\n"
                f"Proof page: {job['artifacts']['proofPageUrl']}\n\n"
                "Authorize the Stripe test payment when you’re ready. I’ll start the work after authorization, "
                "then capture only if Browserbase verifies the accepted criteria."
            ),
        )
        asyncio.create_task(poll_job_updates(ctx, sender, job_id))
        return

    if ("status" in lowered or "proof" in lowered) and job_id:
        try:
            response = requests.get(f"{ORCHESTRATOR_URL}/jobs/{job_id}", timeout=30)
            response.raise_for_status()
            job = response.json()
        except Exception as exc:
            await ctx.send(sender, text_message(f"I couldn’t find that job yet: {exc}"))
            return

        await ctx.send(sender, text_message(format_job_summary(job)))
        return

    if is_greeting(goal):
        await ctx.send(
            sender,
            text_message(
                "Tell me the feature you want shipped, and I’ll turn it into a fixed completion contract.\n\n"
                "Example: “Make the Watchlist page work well on mobile while preserving the desktop table.”"
            ),
        )
        return

    try:
        response = requests.post(
            f"{ORCHESTRATOR_URL}/jobs",
            json={
                "goal": goal,
                "stack": "nextjs",
                "requestedBy": sender,
                "price": "demo-completion-credit",
            },
            timeout=30,
        )
        response.raise_for_status()
        job = response.json()
    except Exception as exc:
        await ctx.send(
            sender,
            text_message(f"I couldn’t draft the completion contract yet: {exc}"),
        )
        return

    await ctx.send(
        sender,
        text_message(
            "Sure. I can take this as a fixed-price delivery task.\n\n"
            "GitHub is connected for the demo repo, so I inspected the supported Next.js target and drafted "
            "the checks I’ll use to decide whether the work is actually done.\n\n"
            f"Job `{job['id']}`\n"
            f"Repo: `{job['repoFullName']}`\n"
            f"Estimated price: `{job['price']}`\n\n"
            "I’ll sign off only if these pass:\n"
            f"{format_criteria(job)}\n\n"
            "You can adjust the scope now. If this looks right, reply:\n\n"
            f"`approve {job['id']}`\n\n"
            "That freezes the contract, creates the payment authorization, and starts the execution flow."
        ),
    )


@protocol.on_message(model=ChatAcknowledgement)
async def handle_chat_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info("Received chat acknowledgement from %s for %s", sender, msg.acknowledged_msg_id)


agent.include(protocol, publish_manifest=True)


if __name__ == "__main__":
    agent.run()
