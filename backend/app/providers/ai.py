from typing import Protocol

import httpx

from app.config import settings


class AIProvider(Protocol):
    async def guidance(
        self,
        *,
        child_name: str,
        target_sound: str,
        mastery: float,
        words: list[str],
        language: str | None = None,
        difficulty: str | None = None,
        therapy_goal: str | None = None,
        attempt_result: str | None = None,
    ) -> str: ...


class DeterministicAIProvider:
    async def guidance(
        self,
        *,
        child_name: str,
        target_sound: str,
        mastery: float,
        words: list[str],
        language: str | None = None,
        difficulty: str | None = None,
        therapy_goal: str | None = None,
        attempt_result: str | None = None,
    ) -> str:
        selected = ", ".join(words[:3]) or "familiar words"
        language = (language or "en").lower()
        goal = (therapy_goal or "keep practice calm and encouraging").strip()
        result = (attempt_result or "the current attempt").strip()

        prompts = {
            "en": {
                "low": f"Keep {child_name}'s {target_sound} practice short and familiar with {selected}. Try one slow, clear repeat and then a quick reset. The therapist remains the decision-maker.",
                "mid": f"Give {child_name} a mix of familiar {target_sound} words and one gentle challenge such as {selected}. Focus on {goal}; therapist guidance stays in control.",
                "high": f"{child_name} is building confidence with {target_sound}. Keep the reps calm and repeatable, celebrate {result}, and use a few familiar words before any new challenge. The therapist remains the decision-maker.",
            },
            "es": {
                "low": f"Mantén la práctica de {target_sound} de {child_name} breve y familiar con {selected}. Haz una repetición lenta y clara y luego vuelve a empezar. El terapeuta sigue siendo quien toma las decisiones.",
                "mid": f"Da a {child_name} una mezcla de palabras familiares de {target_sound} y un reto suave como {selected}. Concéntrate en {goal}; la guía del terapeuta sigue teniendo el control.",
                "high": f"{child_name} está ganando confianza con {target_sound}. Mantén las repeticiones calmadas y repetibles, celebra {result} y usa unas cuantas palabras familiares antes de un reto nuevo. El terapeuta sigue siendo quien toma las decisiones.",
            },
            "fr": {
                "low": f"Restez sur une pratique courte et familière de {target_sound} pour {child_name} avec {selected}. Faites une répétition lente et claire, puis reprenez calmement. Le thérapeute reste le décideur.",
                "mid": f"Donnez à {child_name} un mélange de mots familiers avec {target_sound} et un petit défi doux comme {selected}. Concentrez-vous sur {goal}; le thérapeute garde le contrôle.",
                "high": f"{child_name} gagne en confiance avec {target_sound}. Gardez les répétitions calmes et répétitives, célébrez {result}, puis ajoutez quelques mots familiers avant un nouveau défi. Le thérapeute reste le décideur.",
            },
            "pt": {
                "low": f"Mantenha a prática de {target_sound} de {child_name} curta e familiar com {selected}. Faça uma repetição lenta e clara e depois recomece. O terapeuta continua sendo quem toma as decisões.",
                "mid": f"Dê a {child_name} uma mistura de palavras familiares de {target_sound} e um desafio leve como {selected}. Foque em {goal}; a orientação do terapeuta continua no controle.",
                "high": f"{child_name} está ganhando confiança com {target_sound}. Mantenha as repetições calmas e repetíveis, celebre {result} e use algumas palavras familiares antes de qualquer desafio novo. O terapeuta continua sendo quem toma as decisões.",
            },
        }

        locale = prompts.get(language, prompts["en"])
        if mastery < 55:
            return locale["low"]
        if mastery < 75:
            return locale["mid"]
        return locale["high"]


class GeminiAIProvider:
    async def guidance(
        self,
        *,
        child_name: str,
        target_sound: str,
        mastery: float,
        words: list[str],
        language: str | None = None,
        difficulty: str | None = None,
        therapy_goal: str | None = None,
        attempt_result: str | None = None,
    ) -> str:
        if not settings.gemini_api_key:
            raise RuntimeError("Gemini is not configured")
        goal = (therapy_goal or "keep practice calm and encouraging").strip()
        result = (attempt_result or "the current attempt").strip()
        prompt = (
            "You are a supportive assistant for a licensed speech therapist. "
            "Give one concise learning suggestion from the provided practice data. "
            "Do not diagnose, make clinical decisions, calculate mastery, score pronunciation, or choose treatment. "
            "Mention that the therapist remains the decision-maker. Return no more than 55 words.\n"
            f"child={child_name}; sound={target_sound}; mastery={mastery}; words={words}; language={language or 'en'}; difficulty={difficulty or 'steady'}; therapy_goal={goal}; attempt_result={result}"
        )
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                params={"key": settings.gemini_api_key},
                json={"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.3, "maxOutputTokens": 200}},
            )
            response.raise_for_status()
            data = response.json()
            text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
            if not text:
                raise RuntimeError("Gemini returned no guidance")
            return text
