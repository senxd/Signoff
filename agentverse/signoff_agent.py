import os
import re
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

load_dotenv()

AGENT_NAME = os.getenv("AGENT_NAME", "signoff")
AGENT_PORT = int(os.getenv("AGENT_PORT", "8001"))
AGENT_SEED_PHRASE = os.getenv("AGENT_SEED_PHRASE", "replace-with-a-long-unique-seed")
ORCHESTRATOR_URL = os.getenv("ORCHESTRATOR_URL", "http://localhost:8787")

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
        lines.append(f"- {criterion['id']}: {criterion['description']}")
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

    return (
        f"Job: {job['id']}\n"
        f"Status: {job['status']}\n"
        f"Contract hash: {job.get('contractHash', 'not approved yet')}\n"
        f"Verdict: {verdict.get('outcome', 'pending')}\n"
        f"Merge eligible: {verdict.get('mergeEligible', False)}\n"
        f"Payment eligible: {verdict.get('paymentEligible', False)}\n"
        f"Payment state: {job['payment']['status']}\n"
        f"PR: {job['artifacts'].get('pullRequestUrl', 'pending')}\n"
        f"Preview: {job.get('previewUrl', 'pending')}\n"
        f"Browserbase replay: {job['artifacts'].get('browserbaseReplayUrl', 'pending')}\n"
        f"Proof page: {job['artifacts']['proofPageUrl']}\n\n"
        "Criterion results:\n"
        + ("\n".join(evidence_lines) if evidence_lines else "pending")
    )


def extract_job_id(goal: str) -> str | None:
    match = re.search(r"\b[A-Za-z0-9_-]{8,14}\b", goal)
    return match.group(0) if match else None


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
                "Send a concrete Next.js completion goal, for example: "
                "'Improve the mobile dashboard layout and verify it.'"
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
            await ctx.send(sender, text_message(f"I could not approve the contract: {exc}"))
            return

        await ctx.send(
            sender,
            text_message(
                "Contract approved and frozen.\n\n"
                f"Contract hash: {job.get('contractHash')}\n"
                f"Stripe Checkout: {job['payment'].get('checkoutUrl', 'not configured')}\n"
                f"Payment state: {job['payment']['status']}\n\n"
                "Authorize the Stripe test payment to start execution. I will capture it only if "
                "the deterministic verdict is satisfied; otherwise I cancel the authorization.\n\n"
                f"Proof page: {job['artifacts']['proofPageUrl']}"
            ),
        )
        return

    if ("status" in lowered or "proof" in lowered) and job_id:
        try:
            response = requests.get(f"{ORCHESTRATOR_URL}/jobs/{job_id}", timeout=30)
            response.raise_for_status()
            job = response.json()
        except Exception as exc:
            await ctx.send(sender, text_message(f"I could not retrieve the job: {exc}"))
            return

        await ctx.send(sender, text_message(format_job_summary(job)))
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
            text_message(f"I could not create the completion contract: {exc}"),
        )
        return

    await ctx.send(
        sender,
        text_message(
            "Completion contract draft created. Review these frozen checks before work starts.\n\n"
            f"Job: {job['id']}\n"
            f"Status: {job['status']}\n"
            f"Repo: {job['repoFullName']}\n"
            f"Price: {job['price']}\n"
            f"Proof page: {job['artifacts']['proofPageUrl']}\n\n"
            "Criteria:\n"
            f"{format_criteria(job)}\n\n"
            f"Reply `approve {job['id']}` to freeze the contract hash and create the Stripe authorization."
        ),
    )


@protocol.on_message(model=ChatAcknowledgement)
async def handle_chat_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info("Received chat acknowledgement from %s for %s", sender, msg.acknowledged_msg_id)


agent.include(protocol, publish_manifest=True)


if __name__ == "__main__":
    agent.run()
