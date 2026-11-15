import unittest
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

import webapp


class WebAppTests(unittest.TestCase):
    def setUp(self):
        with webapp._jobs_lock:
            webapp._jobs.clear()
            webapp._request_times.clear()

    def tearDown(self):
        with webapp._jobs_lock:
            webapp._jobs.clear()
            webapp._request_times.clear()

    def payload(self, **changes):
        data = {
            "url": "https://www.youtube.com/watch?v=video-id",
            "provider": "gemini",
            "api_key": "secret-test-key",
            "model": "gemini-example",
            "consent": True,
        }
        data.update(changes)
        return webapp.StartJobRequest(**data)

    def test_homepage_and_assets_exist(self):
        html = (webapp.STATIC_DIR / "index.html").read_text(encoding="utf-8")
        css = (webapp.STATIC_DIR / "styles.css").read_text(encoding="utf-8")
        js = (webapp.STATIC_DIR / "app.js").read_text(encoding="utf-8")

        self.assertTrue((webapp.STATIC_DIR / "index.html").is_file())
        self.assertIn("Vídeos longos.", html)
        self.assertIn('id="summary-form"', html)
        self.assertIn(".workspace-section", css)
        self.assertIn("function setupWebGL()", js)
        self.assertEqual(webapp.home().path, webapp.STATIC_DIR / "index.html")

    def test_rejects_urls_outside_youtube_allowlist(self):
        with self.assertRaises(HTTPException) as error:
            webapp._validate_request(self.payload(url="https://example.com/video"))

        self.assertEqual(error.exception.status_code, 422)
        self.assertIn("YouTube", error.exception.detail)

    def test_rejects_custom_ports_and_credentials_in_url(self):
        for url in (
            "https://youtube.com:8443/watch?v=video",
            "https://user:pass@youtube.com/watch?v=video",
        ):
            with self.subTest(url=url):
                with self.assertRaises(HTTPException):
                    webapp._validate_request(self.payload(url=url))

    def test_requires_transcript_sharing_consent(self):
        with self.assertRaises(HTTPException) as error:
            webapp._validate_request(self.payload(consent=False))

        self.assertIn("transcrição", error.exception.detail)

    def test_accepted_job_does_not_return_or_persist_api_key(self):
        request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))
        with patch.object(webapp._executor, "submit", return_value=None):
            result = webapp.create_job(self.payload(), request)

        self.assertEqual(result["status"], "queued")
        self.assertNotIn("secret-test-key", repr(result))
        job = webapp.get_job(result["id"])
        self.assertEqual(job["status"], "queued")
        self.assertNotIn("secret-test-key", repr(job))

    def test_worker_processes_video_and_keeps_key_out_of_result(self):
        job_id = "job-for-test"
        webapp._jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 3,
            "message": "Na fila",
            "title": None,
            "summary": None,
            "transcript": None,
            "created_at": time.time(),
        }
        with (
            patch.object(
                webapp.resumir_video,
                "baixar_audio",
                return_value=(Path("audio.wav"), "Vídeo de teste"),
            ),
            patch.object(
                webapp.resumir_video,
                "transcrever_audio",
                return_value="Uma transcrição simples.",
            ),
            patch.object(
                webapp,
                "_call_gemini",
                return_value="Resumo de teste.",
            ),
        ):
            webapp._process_job(
                job_id,
                "https://www.youtube.com/watch?v=video-id",
                "base",
                "pt",
                "gemini",
                "gemini-example",
                "secret-test-key",
            )

        result = webapp.get_job(job_id)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["summary"], "Resumo de teste.")
        self.assertEqual(result["transcript"], "Uma transcrição simples.")
        self.assertNotIn("secret-test-key", repr(result))

    def test_secret_key_is_redacted_from_request_model_repr(self):
        self.assertNotIn("secret-test-key", repr(self.payload()))

    def test_gemini_request_uses_key_header_and_generates_summary(self):
        response = SimpleNamespace(
            status_code=200,
            ok=True,
            json=lambda: {
                "candidates": [
                    {"content": {"parts": [{"text": "Síntese do vídeo."}]}}
                ]
            },
        )
        with patch.object(webapp.requests, "post", return_value=response) as post:
            summary = webapp._call_gemini(
                "resuma",
                "gemini-example",
                "secret-test-key",
            )

        self.assertEqual(summary, "Síntese do vídeo.")
        self.assertEqual(post.call_args.kwargs["headers"]["x-goog-api-key"], "secret-test-key")
        self.assertNotIn("secret-test-key", post.call_args.args[0])

    def test_groq_request_uses_bearer_key_and_generates_summary(self):
        response = SimpleNamespace(
            status_code=200,
            ok=True,
            json=lambda: {
                "choices": [{"message": {"content": "Síntese Llama."}}]
            },
        )
        with patch.object(webapp.requests, "post", return_value=response) as post:
            summary = webapp._call_groq(
                "resuma",
                "llama-example",
                "secret-test-key",
            )

        self.assertEqual(summary, "Síntese Llama.")
        self.assertEqual(
            post.call_args.kwargs["headers"]["Authorization"],
            "Bearer secret-test-key",
        )
        self.assertNotIn("secret-test-key", post.call_args.args[0])

    def test_model_list_is_filtered_to_generative_models(self):
        response = SimpleNamespace(
            status_code=200,
            ok=True,
            json=lambda: {
                "models": [
                    {
                        "name": "models/gemini-pro",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                    {
                        "name": "models/text-embedding",
                        "supportedGenerationMethods": ["embedContent"],
                    },
                ]
            },
        )
        with patch.object(webapp.requests, "get", return_value=response) as get:
            models = webapp._list_provider_models("gemini", "secret-test-key")

        self.assertEqual(models, ["gemini-pro"])
        self.assertEqual(
            get.call_args.kwargs["headers"]["x-goog-api-key"],
            "secret-test-key",
        )


if __name__ == "__main__":
    unittest.main()
