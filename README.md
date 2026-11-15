# SumarrizedVideos

Uma experiência web para transformar vídeos em ideias claras. Cole um link do
YouTube, escolha um modelo de IA e receba uma síntese com os principais tópicos
e conclusões.

## Aplicação web

### Requisitos

- Python 3.10+
- `ffmpeg` instalado e disponível no `PATH`
- Uma chave de API do Gemini ou de um provedor Groq com acesso ao modelo Llama

Instale o `ffmpeg` no Ubuntu/Debian:

```bash
sudo apt install ffmpeg
```

### Executar localmente

```bash
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn webapp:app --host 127.0.0.1 --port 8000
```

Abra `http://127.0.0.1:8000` no navegador. O servidor baixa e transcreve o
vídeo com `yt-dlp` e `faster-whisper`; o resumo é gerado pelo provedor
selecionado na página.

### Provedores de IA

- **Gemini:** informe sua chave do Google AI e um ID de modelo Gemini.
- **Llama via Groq:** informe sua chave Groq e um ID de modelo Llama disponível
  para sua conta. A disponibilidade de modelos depende do provedor.

Use **Buscar modelos** para consultar os modelos acessíveis com sua chave; o
campo também aceita IDs digitados manualmente. O custo de geração é cobrado
pelo provedor na conta associada à chave informada. O download e a transcrição
acontecem no servidor que executa o SumarrizedVideos.

### Chaves e dados

- A chave é enviada ao backend por HTTPS quando publicado e fica apenas em
  memória durante a tarefa; não é escrita em banco de dados ou arquivo.
- A chave não é retornada pela API nem incluída intencionalmente nos logs da
  aplicação. O formulário a limpa assim que a tarefa é aceita.
- A transcrição é enviada ao provedor escolhido para gerar o resumo. A página
  pede consentimento antes de iniciar.
- Áudio é mantido em diretório temporário e removido ao fim do processamento.
- Tarefas e transcrições ficam em memória por até uma hora e desaparecem ao
  reiniciar o servidor.
- O serviço aceita apenas links HTTPS do YouTube, limita vídeos a duas horas,
  mantém uma fila curta e aplica um limite simples de tarefas por IP.

> **Importante:** a configuração atual é adequada para desenvolvimento e uso
> local. Antes de disponibilizar publicamente, coloque o serviço atrás de
> HTTPS e configure autenticação, limites de uso compartilhados entre
> instâncias, uma fila persistente, monitoramento e políticas de retenção.
> Chaves inseridas no site são processadas pelo servidor; não prometa que elas
> nunca saem do dispositivo do usuário.

## CLI

O script original continua disponível. Para usá-lo, instale o Ollama, baixe um
modelo e inicie o serviço:

```bash
ollama pull llama3.1
python resumir_video.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

Opções:

| Opção | Descrição | Padrão |
|---|---|---|
| `--modelo` | Modelo Whisper: `tiny`, `base`, `small`, `medium` ou `large` | `base` |
| `--idioma` | Idioma do áudio, como `pt` ou `en`; `""` detecta automaticamente | `pt` |
| `--modelo-llm` | Modelo já instalado no Ollama | `llama3.1` |
| `--salvar-transcricao` | Arquivo onde salvar a transcrição | não salva |

## Testes

```bash
python -m unittest discover -s tests -v
```
