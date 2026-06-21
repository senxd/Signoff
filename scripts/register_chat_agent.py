import os
from pathlib import Path

from dotenv import load_dotenv
from uagents_core.utils.registration import (
    RegistrationRequestCredentials,
    register_chat_agent,
)

load_dotenv("/opt/signoff/secrets/control.env")
load_dotenv()

agent_mailbox = os.environ.get("AGENT_MAILBOX", "true").lower() not in {"0", "false", "no"}
if agent_mailbox:
    raise SystemExit(
        "AGENT_MAILBOX is enabled; start agentverse/signoff_agent.py to publish mailbox details instead."
    )

readme_path = Path(__file__).resolve().parent.parent / "agentverse" / "README.md"

register_chat_agent(
    os.environ.get("AGENT_NAME", "signoff"),
    os.environ["AGENT_ENDPOINT"],
    active=True,
    track_interactions=False,
    description="Verified software delivery with fixed criteria, PRs, Browserbase proof, and payment-gated signoff.",
    readme=readme_path.read_text(encoding="utf-8"),
    credentials=RegistrationRequestCredentials(
        agentverse_api_key=os.environ["AGENTVERSE_KEY"],
        agent_seed_phrase=os.environ["AGENT_SEED_PHRASE"],
    ),
)
