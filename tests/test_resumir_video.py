import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import resumir_video


class DividirTextoTests(unittest.TestCase):
    def test_partes_respeitam_limite_e_preservam_palavras(self):
        texto = " ".join(["palavra"] * 10)

        partes = resumir_video.dividir_texto(texto, limite=20)

        self.assertGreater(len(partes), 1)
        self.assertTrue(all(len(parte) <= 20 for parte in partes))
        self.assertEqual(" ".join(partes), texto)

    def test_texto_vazio_nao_cria_partes(self):
        self.assertEqual(resumir_video.dividir_texto(" \n "), [])


class FluxoTests(unittest.TestCase):
    def test_transcricao_vazia_interrompe_fluxo_com_erro_claro(self):
        saida_erro = io.StringIO()
        with (
            patch.object(sys, "argv", ["resumir_video.py", "https://example.com/video"]),
            patch.object(resumir_video, "baixar_audio", return_value=(Path("audio.wav"), "Vídeo")),
            patch.object(resumir_video, "transcrever_audio", return_value="  \n"),
            patch.object(resumir_video, "resumir_texto") as resumir,
            contextlib.redirect_stderr(saida_erro),
        ):
            with self.assertRaises(SystemExit) as erro:
                resumir_video.main()

        self.assertEqual(erro.exception.code, 1)
        self.assertIn("Nenhuma fala foi reconhecida", saida_erro.getvalue())
        resumir.assert_not_called()

    def test_transcricao_longa_gera_resumos_parciais_e_final(self):
        class Resposta:
            def raise_for_status(self):
                pass

            def json(self):
                return {"response": "Resumo"}

        texto = " ".join(["conteudo"] * 3000)
        with patch("requests.post", return_value=Resposta()) as post:
            resultado = resumir_video.resumir_texto(texto, "Vídeo")

        self.assertEqual(resultado, "Resumo")
        self.assertGreater(post.call_count, 2)
        self.assertIn("parte", post.call_args_list[0].kwargs["json"]["prompt"])


if __name__ == "__main__":
    unittest.main()
