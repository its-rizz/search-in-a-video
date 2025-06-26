import requests
from duckduckgo_search import DDGS

class GPTService:
    # API_URL = "https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct"
    API_URL = "https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1"
    API_TOKEN = "your_huggingface_token"  #  Replace with your Hugging Face token

    @staticmethod
    def get_web_context(query, num_results=3):
        print(f"🔍 Searching web for context on: {query}")
        results = []
        try:
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=num_results):
                    results.append(r["body"])
        except Exception as e:
            print(f"Error during web search: {e}")
        return "\n".join(results) if results else "No context available."

    @staticmethod
    def generate_prompt(question, context):
        prompt = (
            "You are a helpful assistant.\n"
            "Use the context below to answer the question.\n\n"
            f"Context:\n{context}\n\n"
            f"Question:\n{question}\n\n"
            "Answer:"
        )
        return prompt

    @staticmethod
    def get_ai_response(question):
        context = GPTService.get_web_context(question)
        prompt = GPTService.generate_prompt(question, context)

        headers = {
            "Authorization": f"Bearer {GPTService.API_TOKEN}",
            "Content-Type": "application/json"
        }

        payload = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": 300,
                "temperature": 0.7,
                "top_p": 0.9,
                "do_sample": True
            }
        }

        try:
            print(" Sending prompt to Falcon-7B...")
            response = requests.post(GPTService.API_URL, headers=headers, json=payload)
            response.raise_for_status()
            result = response.json()

            if isinstance(result, list) and len(result) > 0:
                output = result[0].get("generated_text", "")
                answer = output.strip().split("Answer:")[-1].strip()
                return answer if answer else "No answer generated."
            else:
                return "No valid response from the model."

        except Exception as e:
            print(f" Error: {e}")
            return "Failed to generate a response."

if __name__ == "__main__":
    question = input("Ask your question: ")
    answer = GPTService.get_ai_response(question)
    print(f"\n Answer:\n{answer}")
