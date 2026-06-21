import os

from dotenv import load_dotenv
from uagents_core.utils.registration import (
    RegistrationRequestCredentials,
    register_chat_agent,
)

load_dotenv()

register_chat_agent(
    os.environ.get("AGENT_NAME", "signoff"),
    os.environ["AGENT_ENDPOINT"],
    active=True,
    credentials=RegistrationRequestCredentials(
        agentverse_api_key=os.environ["AGENTVERSE_KEY"],
        agent_seed_phrase=os.environ["AGENT_SEED_PHRASE"],
    ),
)
