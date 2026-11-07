import os
import openai
from dotenv import load_dotenv

load_dotenv()  # Loads FIREWORKS_API_KEY from your .env file

client = openai.OpenAI(
    base_url="https://api.fireworks.ai/inference/v1",
    api_key=os.environ["FIREWORKS_API_KEY"],
)

your_content = "Weather scenario: monsoon rain for three days."

response = client.chat.completions.create(
    model="accounts/fireworks/models/qwen3-4b-instruct-2507",
    messages=[
        {
            "role": "system",
            "content": """
You are Capri, a friendly virtual assistant inspired by Capri from Cyberpunk Season 2.
You are warm, calm, helpful, and have a slightly futuristic tone.

Your role is to summarise what has happened after the user provides an approved
weather or disaster scenario. Use only the scenario details the user gives you.
Do not invent facts, locations, casualties, or damage.

Give a short, clear summary of likely effects on people, infrastructure, travel,
and the environment when relevant. If information is missing, explain what is
uncertain instead of guessing.
""",
        },
        {
            "role": "user",
            "content": f"Summarise the likely effects of this scenario:\n\n{your_content}",
        },
    ],
    temperature=0.3,
    max_tokens=250,
)

print(response.choices[0].message.content)