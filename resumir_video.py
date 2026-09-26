#!/usr/bin/env python3
"""
Resumidor de vídeos do YouTube
-------------------------------
Baixa o áudio de um vídeo do YouTube, transcreve automaticamente com Whisper
e envia o texto para um modelo local via Ollama para gerar um resumo,
exibindo tudo direto no terminal. Tudo roda localmente e de graça.

Uso:
    python resumir_video.py "https://www.youtube.com/watch?v=XXXXXXX"
    python resumir_video.py "URL" --modelo small --idioma pt

Requisitos:
    - Python 3.9+
    - ffmpeg instalado no sistema (necessário para o yt-dlp extrair áudio)
    - Ollama instalado e rodando (https://ollama.com), com um modelo baixado
      (ex: ollama pull llama3.1)
    - Dependências: pip install -r requirements.txt

Desenvolvido por Caio Salgado Marques
"""

import argparse
import sys
import tempfile
from pathlib import Path


def baixar_audio(url: str, pasta_destino: Path) -> Path:
    """Baixa apenas o áudio do vídeo do YouTube usando yt-dlp e converte para wav."""
    import yt_dlp

    saida_template = str(pasta_destino / "audio.%(ext)s")

    opcoes = {
        "format": "bestaudio/best",
        "outtmpl": saida_template,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "192",
            }
        ],
        "quiet": True,
        "no_warnings": True,
        "noprogress": False,
    }

    print("[1/3] Baixando áudio do vídeo...")
    with yt_dlp.YoutubeDL(opcoes) as ydl:
        info = ydl.extract_info(url, download=True)
        titulo = info.get("title", "video")

    caminho_audio = pasta_destino / "audio.wav"
    if not caminho_audio.exists():
        # fallback: procura qualquer arquivo de áudio gerado
        candidatos = list(pasta_destino.glob("audio.*"))
        if not candidatos:
            raise FileNotFoundError("Não foi possível localizar o áudio baixado.")
        caminho_audio = candidatos[0]

    print(f"    -> Áudio salvo em: {caminho_audio}")
    return caminho_audio, titulo


def transcrever_audio(caminho_audio: Path, modelo: str, idioma: str | None) -> str:
    """Transcreve o áudio localmente usando faster-whisper (leve, roda bem na CPU)."""
    from faster_whisper import WhisperModel

    print(f"[2/3] Transcrevendo áudio (modelo Whisper: {modelo})...")
    modelo_whisper = WhisperModel(modelo, device="cpu", compute_type="int8")

    kwargs = {}
    if idioma:
        kwargs["language"] = idioma

    segmentos, _info = modelo_whisper.transcribe(str(caminho_audio), **kwargs)
    texto = " ".join(segmento.text.strip() for segmento in segmentos)
    print(f"    -> Transcrição concluída ({len(texto)} caracteres).")
    return texto


def resumir_texto(texto: str, titulo: str, modelo: str = "llama3.1") -> str:
    """Gera o resumo usando um modelo local via Ollama (gratuito, roda na sua máquina).

    Pré-requisito: ter o Ollama instalado e rodando (https://ollama.com) e o
    modelo baixado com: ollama pull <modelo>
    """
    import requests

    print(f"[3/3] Gerando resumo localmente com Ollama (modelo: {modelo})...")

    prompt = f"""Você recebeu a transcrição automática (pode conter pequenos erros) de um vídeo do YouTube chamado "{titulo}".

Gere um resumo em português contendo:
1. Um resumo geral em até 5 frases.
2. Os principais pontos/tópicos abordados, em bullets.
3. Se houver, conclusões, recomendações ou chamadas para ação mencionadas no vídeo.

Transcrição:
\"\"\"
{texto}
\"\"\""""

    try:
        resposta = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": modelo,
                "prompt": prompt,
                "stream": False,
            },
            timeout=600,
        )
        resposta.raise_for_status()
    except requests.exceptions.ConnectionError:
        raise ConnectionError(
            "Não foi possível conectar ao Ollama em http://localhost:11434. "
            "Verifique se o Ollama está instalado e rodando (abra o app ou "
            "rode 'ollama serve'), e se o modelo foi baixado com: "
            f"ollama pull {modelo}"
        )

    return resposta.json()["response"].strip()


def main():
    parser = argparse.ArgumentParser(
        description="Baixa, transcreve e resume um vídeo do YouTube (100% local e gratuito)."
    )
    parser.add_argument("url", help="URL do vídeo do YouTube")
    parser.add_argument(
        "--modelo",
        default="base",
        choices=["tiny", "base", "small", "medium", "large"],
        help="Tamanho do modelo Whisper a usar (padrão: base). "
        "Modelos maiores são mais precisos, porém mais lentos.",
    )
    parser.add_argument(
        "--idioma",
        default="pt",
        help="Código do idioma do áudio para acelerar a transcrição (padrão: pt). "
        "Use '' para detecção automática.",
    )
    parser.add_argument(
        "--modelo-llm",
        default="llama3.1",
        help="Modelo do Ollama usado para gerar o resumo (padrão: llama3.1). "
        "Precisa ter sido baixado antes com: ollama pull <modelo>",
    )
    parser.add_argument(
        "--salvar-transcricao",
        metavar="ARQUIVO",
        help="Se informado, salva a transcrição completa nesse arquivo de texto.",
    )
    args = parser.parse_args()

    idioma = args.idioma if args.idioma else None

    with tempfile.TemporaryDirectory() as pasta_tmp:
        pasta_tmp = Path(pasta_tmp)
        try:
            caminho_audio, titulo = baixar_audio(args.url, pasta_tmp)
            texto = transcrever_audio(caminho_audio, args.modelo, idioma)

            if args.salvar_transcricao:
                Path(args.salvar_transcricao).write_text(texto, encoding="utf-8")
                print(f"    -> Transcrição salva em: {args.salvar_transcricao}")

            resumo = resumir_texto(texto, titulo, args.modelo_llm)

            print("\n" + "=" * 60)
            print(f"RESUMO: {titulo}")
            print("=" * 60)
            print(resumo)
            print("=" * 60)

        except Exception as e:
            print(f"\nErro: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()