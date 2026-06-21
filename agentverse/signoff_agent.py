import os
import sys

if not os.path.exists("/opt/signoff") and os.getenv("FORCE_LOCAL_AGENT") != "1":
    print("Local agent execution disabled to prevent conflicts with droplet.")
    sys.exit(0)

import re
import asyncio
import json
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
AGENT_ENDPOINT = os.getenv("AGENT_ENDPOINT")
AGENT_MAILBOX = os.getenv("AGENT_MAILBOX", "true").lower() not in {"0", "false", "no"}
ORCHESTRATOR_URL = os.getenv("ORCHESTRATOR_URL", "http://localhost:8787")
POLL_INTERVAL_SEC = int(os.getenv("SIGNOFF_POLL_INTERVAL_SEC", "5"))
POLL_TIMEOUT_SEC = int(os.getenv("SIGNOFF_POLL_TIMEOUT_SEC", str(30 * 60)))

active_polls: set[str] = set()

# Python 3.14+ requires an explicit event loop (get_event_loop no longer creates one)
try:
    asyncio.get_running_loop()
except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

agent_config = {
    "name": AGENT_NAME,
    "seed": AGENT_SEED_PHRASE,
    "port": AGENT_PORT,
    "mailbox": AGENT_MAILBOX,
    "publish_agent_details": True,
    "readme_path": "agentverse/README.md",
}
if not AGENT_MAILBOX and AGENT_ENDPOINT:
    agent_config["endpoint"] = AGENT_ENDPOINT

agent = Agent(**agent_config)

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
        error = evidence.get("error")
        suffix = f" — {error}" if error else ""
        evidence_lines.append(f"- {criterion['id']}: {status}{suffix}")

    outcome = verdict.get("outcome", "pending")
    status = job["status"]
    if outcome == "satisfied":
        opener = "Done. The accepted checks passed, so this is ready for review."
    elif outcome == "not_satisfied":
        opener = "I can't sign off on this yet. The implementation ran, but one of the accepted checks failed."
    elif outcome == "verification_error":
        opener = "I can't sign off on this yet. Verification did not produce reliable enough evidence."
    elif status in {"building", "verifying", "authorized"}:
        opener = "It's in progress. I'll keep the contract fixed and verify the finished commit before release."
    else:
        opener = "Here's the latest on this Signoff job."

    return (
        f"{opener}\n\n"
        f"Job **{job['id']}** · **{status}**\n\n"
        f"Verdict: **{outcome}** · Payment: **{job['payment']['status']}**\n\n"
        f"Merge eligible: **{verdict.get('mergeEligible', False)}** · Payment eligible: **{verdict.get('paymentEligible', False)}**\n\n"
        f"PR: {job['artifacts'].get('pullRequestUrl', 'pending')}\n\n"
        f"Proof: {job['artifacts']['proofPageUrl']}\n\n"
        f"Browser replay: {job['artifacts'].get('browserbaseReplayUrl', 'pending')}\n\n"
        "Checks:\n\n"
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
        "ping",
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


def fetch_job_events(job_id: str) -> list:
    try:
        response = requests.get(f"{ORCHESTRATOR_URL}/jobs/{job_id}/events", timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception:
        return []


def get_latest_failed_reason(job_id: str, attempt: int) -> str:
    try:
        events = fetch_job_events(job_id)
        for event in reversed(events):
            if event.get("type") == "repair.started":
                data = event.get("data") or {}
                if data.get("repairAttempts") == attempt:
                    verdict = data.get("verdict") or {}
                    reason = verdict.get("reason")
                    if reason:
                        return reason
    except Exception:
        pass
    return "One of the frozen checks failed."


def get_duration_sec(start_iso: str, end_iso: str) -> int:
    try:
        s = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        return max(1, int((e - s).total_seconds()))
    except Exception:
        return 0


def format_job_timeline(events: list) -> str:
    attempts = []
    current_attempt = None
    
    # Sort events by timestamp
    events = sorted(events, key=lambda e: e.get("at", ""))
    
    has_auth = False
    for event in events:
        etype = event.get("type")
        at = event.get("at", "")
        data = event.get("data") or {}
        
        if etype == "payment.authorized":
            has_auth = True
            
        elif etype == "build.started":
            attempt_num = data.get("repairAttempts", 0) + 1
            current_attempt = {
                "number": attempt_num,
                "build_start": at,
                "build_end": None,
                "verify_start": None,
                "verify_end": None,
                "failed_reason": None,
                "success": False
            }
            attempts.append(current_attempt)
            
        elif etype == "build.finished" and current_attempt:
            current_attempt["build_end"] = at
            
        elif etype == "browserbase.started" and current_attempt:
            current_attempt["verify_start"] = at
            
        elif etype == "browserbase.finished" and current_attempt:
            current_attempt["verify_end"] = at
            
        elif etype == "repair.started" and current_attempt:
            current_attempt["failed_reason"] = data.get("verdict", {}).get("reason") or "One of the checks failed."
            
        elif etype == "contract.release_eligible" and current_attempt:
            current_attempt["success"] = True
            
    lines = ["**Progress Timeline:**"]
    if has_auth:
        lines.append("•  Stripe Payment Authorized")
        
    for att in attempts:
        num = att["number"]
        lines.append(f"• **Attempt {num}**:")
        
        # Build phase
        if att["build_end"]:
            dur = get_duration_sec(att["build_start"], att["build_end"])
            lines.append(f"  - Coding/Building completed ({dur}s)")
        elif att["build_start"]:
            lines.append("  - ⟳ Coding/Building... (in progress)")
            continue
            
        # Verify phase
        if att["verify_end"]:
            dur = get_duration_sec(att["verify_start"], att["verify_end"])
            lines.append(f"  - Visual Verification completed ({dur}s)")
        elif att["verify_start"]:
            lines.append("  - ⟳ Visual Verification... (in progress)")
            continue
            
        # Outcome
        if att["failed_reason"]:
            lines.append(f"  - Failed: {att['failed_reason']}")
        elif att["success"]:
            lines.append("  - Verification Passed! Payment captured.")
            
    return "\n".join(lines)


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
            # Only sync payment while waiting for authorization; after that
            # just read the job so we don't clobber building/verifying status.
            if not notified_payment:
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
                events = await asyncio.to_thread(fetch_job_events, job_id)
                timeline = format_job_timeline(events)
                await ctx.send(
                    sender,
                    text_message(
                        f"Attempt {repair_attempts} was not satisfied.\n\n"
                        f"{timeline}\n\n"
                        f"Running repair attempt {repair_attempts + 1} under the same frozen contract."
                    ),
                )

            if status in {"building", "verifying"} and notified_status != status:
                notified_status = status
                events = await asyncio.to_thread(fetch_job_events, job_id)
                timeline = format_job_timeline(events)
                await ctx.send(
                    sender,
                    text_message(
                        f"Job status updated to **{status}**.\n\n"
                        f"{timeline}\n\n"
                        f"Job **{job_id}** · Proof page: {job['artifacts']['proofPageUrl']}"
                    ),
                )

            if status in {"completed", "failed"}:
                await ctx.send(sender, text_message(format_job_summary(job)))
                return

            if payment in {"cancelled", "failed"} and status not in {"completed", "failed"}:
                await ctx.send(
                    sender,
                    text_message(
                        f"Stripe authorization did not complete (**{payment}**). "
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
                "Tell me the feature you want shipped, and I'll turn it into a fixed completion contract.\n\n"
                "Example: 'Make the Watchlist page work well on mobile while preserving the desktop table.'"
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
            await ctx.send(sender, text_message(f"I couldn't approve that contract yet: {exc}"))
            return

        await ctx.send(
            sender,
            text_message(
                "Approved. I froze the contract, so the executor can't change the checks later.\n\n"
                f"Contract hash: **{job.get('contractHash')}**\n\n"
                f"Payment link: {job['payment'].get('checkoutUrl', 'not configured')}\n\n"
                f"Proof page: {job['artifacts']['proofPageUrl']}\n\n"
                "Authorize the Stripe test payment when you're ready. I'll start the work after authorization, "
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
            await ctx.send(sender, text_message(f"I couldn't find that job yet: {exc}"))
            return

        await ctx.send(sender, text_message(format_job_summary(job)))
        return

    if is_greeting(goal):
        await ctx.send(
            sender,
            text_message(
                "Tell me the feature you want shipped, and I'll turn it into a fixed completion contract.\n\n"
                "Example: 'Make the Watchlist page work well on mobile while preserving the desktop table.'"
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
            },
            timeout=30,
        )
        response.raise_for_status()
        job = response.json()
    except Exception as exc:
        await ctx.send(
            sender,
            text_message(f"I couldn't draft the completion contract yet: {exc}"),
        )
        return

    await ctx.send(
        sender,
        text_message(
            "Sure. I can take this as a fixed-price delivery task.\n\n"
            "GitHub is connected for the demo repo, so I inspected the supported Next.js target and drafted "
            "the checks I'll use to decide whether the work is actually done.\n\n"
            f"Job **{job['id']}**  ·  Repo: {job.get('repoFullName', 'senxd/signoff-demo-app')}  ·  Estimated price: **{job.get('price', '$20.00 completion authorization')}**\n\n"
            "I'll sign off only if these pass:\n"
            f"{format_criteria(job)}\n\n"
            "You can adjust the scope now. If this looks right, reply:\n\n"
            f"approve **{job['id']}**\n\n"
            "That freezes the contract, creates the payment authorization, and starts the execution flow."
        ),
    )


@protocol.on_message(model=ChatAcknowledgement)
async def handle_chat_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info("Received chat acknowledgement from %s for %s", sender, msg.acknowledged_msg_id)


agent.include(protocol, publish_manifest=True)


def find_active_job_ids() -> list[tuple[str, str]]:
    state_dirs = [
        os.getenv("SIGNOFF_STATE_DIR"),
        "/opt/signoff/state",
        "/private/tmp/signoff-state",
        "jobs"
    ]
    
    active_ids = []
    for base in state_dirs:
        if not base:
            continue
        jobs_dir = os.path.join(base, "jobs") if base != "jobs" else "jobs"
        if os.path.isdir(jobs_dir):
            try:
                for filename in os.listdir(jobs_dir):
                    if filename.endswith(".json") and filename != "test.json":
                        filepath = os.path.join(jobs_dir, filename)
                        try:
                            with open(filepath, "r", encoding="utf-8") as f:
                                data = json.load(f)
                                status = data.get("status")
                                requested_by = data.get("requestedBy")
                                if status in {"payment_pending", "authorized", "building", "verifying"} and requested_by:
                                    active_ids.append((data["id"], requested_by))
                        except Exception:
                            pass
            except Exception:
                pass
            break
    return active_ids


@agent.on_event("startup")
async def resume_polls(ctx: Context):
    ctx.logger.info("Checking for active jobs to resume polling...")
    active_jobs = await asyncio.to_thread(find_active_job_ids)
    for job_id, requested_by in active_jobs:
        ctx.logger.info("Resuming poll loop for active job: %s", job_id)
        asyncio.create_task(poll_job_updates(ctx, requested_by, job_id))


if __name__ == "__main__":
    agent.run()
