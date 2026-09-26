# Resumidor de Vídeos do YouTube

Script em Python que baixa o áudio de um vídeo do YouTube, transcreve
automaticamente com Whisper e gera um resumo usando um modelo local via
Ollama, exibido direto no terminal. Tudo roda no seu computador, sem custo
por uso.

## Pré-requisitos

1. **Python 3.9+**
2. **ffmpeg** instalado no sistema (o `yt-dlp` precisa dele para extrair o áudio):
   - Ubuntu/Debian: `sudo apt install ffmpeg`
   - macOS (Homebrew): `brew install ffmpeg`
   - Windows: baixe em https://ffmpeg.org/download.html e adicione ao PATH
3. **Ollama** instalado (gratuito, roda local): baixe em https://ollama.com
   e, depois de instalar, baixe um modelo:
   ```bash
   ollama pull llama3.1
   ```

## Instalação

```bash
python -m venv venv
source venv/bin/activate   # no Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Usando o ambiente virtual (venv) no dia a dia

O `venv` é uma pasta isolada onde ficam instaladas as bibliotecas Python
desse projeto, sem misturar com outros projetos do seu computador.

- **Ativar** (precisa fazer isso toda vez que abrir um terminal novo, antes
  de rodar o script):
  ```bash
  source venv/bin/activate   # Linux/macOS
  venv\Scripts\activate      # Windows
  ```
  Quando está ativo, o prompt do terminal mostra `(venv)` no começo da linha.

- **Desativar** (sair do ambiente virtual, voltando a usar o Python normal
  do sistema):
  ```bash
  deactivate
  ```

- **Não precisa reinstalar as dependências toda vez.** O `pip install -r
  requirements.txt` só precisa ser rodado uma vez (ou de novo se você
  apagar a pasta `venv` ou trocar de computador). Nas próximas vezes, é só
  ativar o venv (`source venv/bin/activate`) e já usar o script direto —
  as bibliotecas continuam instaladas ali dentro.

- Se fechar o terminal ou reiniciar o computador, o venv **não fica ativo
  sozinho** — é só rodar `source venv/bin/activate` de novo antes de usar
  o script, sem precisar reinstalar nada.

## Uso

Com o Ollama rodando (o app fica aberto em segundo plano, ou rode
`ollama serve` num terminal separado), basta:

```bash
python resumir_video.py "https://www.youtube.com/watch?v=XXXXXXX"
```

Opções disponíveis:

| Opção | Descrição | Padrão |
|---|---|---|
| `--modelo` | Tamanho do modelo Whisper (`tiny`, `base`, `small`, `medium`, `large`) | `base` |
| `--idioma` | Código do idioma do áudio (ex: `pt`, `en`). Use `""` para detecção automática | `pt` |
| `--modelo-llm` | Modelo do Ollama usado no resumo (precisa ter sido baixado com `ollama pull`) | `llama3.1` |
| `--salvar-transcricao` | Caminho de arquivo para salvar a transcrição completa | (não salva) |

Exemplo mais completo:

```bash
python resumir_video.py "https://youtu.be/XXXXXXX" \
    --modelo small \
    --idioma "" \
    --modelo-llm mistral \
    --salvar-transcricao transcricao.txt
```

## Como funciona

1. **Download**: `yt-dlp` baixa apenas a faixa de áudio do vídeo e converte
   para `.wav` usando `ffmpeg`.
2. **Transcrição**: o modelo Whisper (rodando localmente na sua máquina)
   converte o áudio em texto.
3. **Resumo**: a transcrição é enviada para o Ollama, que roda o modelo
   escolhido localmente e devolve um resumo estruturado, impresso no
   terminal.

## Observações

- Modelos Whisper maiores (`medium`, `large`) são mais precisos, mas exigem
  mais RAM/CPU e demoram mais para transcrever.
- **Vídeos com mais de ~30 minutos podem travar ou dar erro em computadores
  mais fracos** (sem GPU dedicada, com pouca RAM, ou CPU de entrada/
  intermediária). A transcrição e o resumo de vídeos longos exigem bastante
  processamento e memória de uma vez só. Se isso acontecer, tente: usar um
  modelo Whisper menor (`--modelo tiny` ou `--modelo base`), usar um modelo
  do Ollama mais leve, ou testar com vídeos mais curtos primeiro.
- A transcrição usa `faster-whisper`, que roda bem em CPU e não baixa as
  bibliotecas pesadas de GPU (CUDA) que o pacote `openai-whisper` original
  costuma puxar como dependência (isso pode facilmente passar de alguns GB
  e estourar cota de disco em ambientes com pouco espaço).
- Vídeos muito longos podem gerar uma transcrição maior do que a janela de
  contexto do modelo do Ollama consegue processar de uma vez (o `llama3.1`
  padrão costuma vir configurado para ~8.000 tokens). Nesse caso o resumo
  pode sair incompleto — se isso acontecer com frequência, dá pra adaptar
  o script para dividir a transcrição em pedaços.
- A velocidade do resumo depende do hardware do seu computador (CPU/GPU),
  já que o modelo roda localmente.
- Nenhum arquivo de áudio fica salvo em disco após a execução (é usado um
  diretório temporário), a menos que você use `--salvar-transcricao` para
  guardar o texto.