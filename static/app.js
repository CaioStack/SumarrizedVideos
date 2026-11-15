const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const toast = $("#toast");
let toastTimeout;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function setupMotion() {
  if (reducedMotion || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("motion-ready");
  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        currentObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  $$(".reveal").forEach((element, index) => {
    if (element.closest(".hero")) {
      element.style.setProperty("--reveal-delay", `${Math.min(index * 65, 320)}ms`);
    }
    observer.observe(element);
  });

  let scrollFrame = 0;
  const heroArt = $(".hero-art");
  const heroCopy = $(".hero-copy");
  window.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        const progress = Math.min(window.scrollY / Math.max(window.innerHeight, 1), 1);
        heroArt.style.setProperty("--scroll-depth", `${progress * -34}px`);
        heroCopy.style.setProperty("--scroll-depth", `${progress * -13}px`);
        scrollFrame = 0;
      });
    },
    { passive: true },
  );
}

function setupWebGL() {
  const canvas = $("#hero-canvas");
  if (!canvas || reducedMotion) return;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    premultipliedAlpha: false,
  });
  if (!gl) {
    canvas.setAttribute("data-webgl-fallback", "true");
    return;
  }

  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_mouse;
    varying vec2 v_uv;

    void main() {
      vec2 point = (v_uv * 2.0 - 1.0);
      point.x *= u_resolution.x / u_resolution.y;
      point -= u_mouse * .035;

      const float radius = .72;
      float radialDistance = length(point);
      float sphereMask = 1.0 - smoothstep(radius - .008, radius + .012, radialDistance);
      float depth = sqrt(max(radius * radius - radialDistance * radialDistance, 0.0));
      vec3 normal = normalize(vec3(point, depth));

      float longitude = atan(normal.z, normal.x) + u_time * .2 + u_mouse.x * .2;
      float latitude = asin(clamp(normal.y, -1.0, 1.0)) + u_mouse.y * .15;
      float bands = sin(longitude * 9.0 + sin(latitude * 12.0 + u_time * .26) * .7);
      float detail = sin(longitude * 21.0 - latitude * 15.0 + u_time * .18);
      float light = max(dot(normal, normalize(vec3(-.46, .68, 1.0))), 0.0);
      float fresnel = pow(1.0 - max(normal.z, 0.0), 2.1);
      vec3 base = mix(vec3(.18, .27, .13), vec3(.62, .78, .38), .37 + light * .38);
      vec3 cool = vec3(.58, .52, .92);
      vec3 color = mix(base, cool, smoothstep(.42, .94, bands) * .32);
      color += vec3(.13, .18, .08) * detail * .18;
      color += vec3(.69, .91, .42) * pow(max(dot(reflect(normalize(vec3(.46, -.68, -1.0)), normal), vec3(0.0, 0.0, 1.0)), 0.0), 25.0) * .6;
      color += mix(vec3(.45, .68, .3), cool, .32) * fresnel * .58;

      float halo = exp(-pow(max(radialDistance - radius * .78, 0.0) * 4.4, 2.0));
      color = mix(vec3(.34, .48, .22), color, sphereMask);
      color += vec3(.24, .34, .16) * halo * .2;
      float alpha = max(sphereMask * (.84 + fresnel * .14), halo * .16);
      alpha *= 1.0 - smoothstep(.82, 1.2, radialDistance);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("WebGL shader compilation failed");
    }
    return shader;
  }

  try {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("WebGL program linking failed");
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    const mouseLocation = gl.getUniformLocation(program, "u_mouse");

    let pointer = { x: 0, y: 0 };
    let targetPointer = { x: 0, y: 0 };
    let animationFrame = 0;
    let startTime = performance.now();

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
      const width = Math.max(1, Math.floor(rect.width * pixelRatio));
      const height = Math.max(1, Math.floor(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolutionLocation, width, height);
    }
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    function pointerMove(event) {
      const rect = canvas.getBoundingClientRect();
      targetPointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      targetPointer.y = -((event.clientY - rect.top) / rect.height - 0.5) * 2;
    }
    canvas.addEventListener("pointermove", pointerMove, { passive: true });
    canvas.addEventListener(
      "pointerleave",
      () => {
        targetPointer = { x: 0, y: 0 };
      },
      { passive: true },
    );

    function draw(now) {
      animationFrame = requestAnimationFrame(draw);
      pointer.x += (targetPointer.x - pointer.x) * 0.035;
      pointer.y += (targetPointer.y - pointer.y) * 0.035;
      gl.uniform1f(timeLocation, (now - startTime) / 1000);
      gl.uniform2f(mouseLocation, pointer.x, pointer.y);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !animationFrame) {
        startTime = performance.now();
        animationFrame = requestAnimationFrame(draw);
      } else if (!entry.isIntersecting && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    });
    visibilityObserver.observe(canvas);

    window.addEventListener(
      "pagehide",
      () => {
        cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
      { once: true },
    );
  } catch {
    canvas.setAttribute("data-webgl-fallback", "true");
  }
}

function setupCursorAndMagnetics() {
  if (!finePointer || reducedMotion) return;
  const cursor = $(".cursor-glow");
  let moveFrame = 0;
  let x = -500;
  let y = -500;

  window.addEventListener(
    "pointermove",
    (event) => {
      x = event.clientX;
      y = event.clientY;
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
        cursor.classList.add("is-visible");
        moveFrame = 0;
      });
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => {
    cursor.classList.remove("is-visible");
  });

  const magnets = $$(".magnetic");
  magnets.forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      element.style.transform = `translate(${dx * 0.07}px, ${dy * 0.12}px)`;
    });
    element.addEventListener("pointerleave", () => {
      element.style.transform = "";
    });
  });

  $$(".step-card[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const xRatio = (event.clientX - rect.left) / rect.width - 0.5;
      const yRatio = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(900px) rotateY(${xRatio * 3.5}deg) rotateX(${-yRatio * 3.5}deg) translateY(-2px)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  });
}

function setupProviderPicker() {
  const providerButtons = $$(".provider-option");
  const modelInput = $("#model-id");
  let activeProvider = "gemini";

  providerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      providerButtons.forEach((option) => {
        const selected = option === button;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-checked", String(selected));
      });

      const nextProvider = button.dataset.provider;
      if (nextProvider !== activeProvider) {
        modelInput.value =
          nextProvider === "gemini"
            ? "gemini-3.8-flash"
            : "llama-3.3-70b-versatile";
        $("#model-options").replaceChildren();
        activeProvider = nextProvider;
      }
    });
  });

  return () => activeProvider;
}

function setPanel(panelName) {
  $("#result-empty").hidden = panelName !== "empty";
  $("#result-progress").hidden = panelName !== "progress";
  $("#result-content").hidden = panelName !== "content";
  $("#result-error").hidden = panelName !== "error";
}

function setLoading(isLoading) {
  const button = $("#submit-button");
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  button.setAttribute("aria-busy", String(isLoading));
  $(".button-label", button).textContent = isLoading
    ? "Preparando seu resumo"
    : "Gerar meu resumo";
}

function updateProgress(job) {
  const stageLabels = {
    queued: "NA FILA",
    downloading: "BUSCANDO O ÁUDIO",
    transcribing: "TRANSCRIÇÃO",
    summarizing: "GERANDO INSIGHTS",
  };
  $("#progress-message").textContent = job.message || "Preparando seu vídeo…";
  $("#progress-stage").textContent = stageLabels[job.stage] || "PROCESSANDO";
  $("#progress-value").textContent = `${String(job.progress || 0).padStart(2, "0")}%`;
  $("#progress-fill").style.width = `${Math.max(3, Math.min(job.progress || 3, 100))}%`;
}

function showError(message) {
  setLoading(false);
  setPanel("error");
  $("#error-message").textContent = message || "Confira seus dados e tente mais uma vez.";
}

function saveTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderSummary(text) {
  const output = $("#summary-output");
  const fragment = document.createDocumentFragment();
  let activeList = null;
  let activeListType = "";

  function appendInlineText(parent, value) {
    const parts = value.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
    parts.forEach((part) => {
      if ((part.startsWith("**") && part.endsWith("**")) ||
          (part.startsWith("__") && part.endsWith("__"))) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.append(strong);
      } else if (part) {
        parent.append(document.createTextNode(part));
      }
    });
  }

  (text || "").split(/\r?\n/).forEach((line) => {
    const value = line.trim();
    if (!value) {
      activeList = null;
      activeListType = "";
      return;
    }

    const heading = value.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      activeList = null;
      activeListType = "";
      const element = document.createElement("h4");
      appendInlineText(element, heading[1]);
      fragment.append(element);
      return;
    }

    const listItem = value.match(/^(?:[-*•]\s+|(\d+)[.)]\s+)(.+)$/);
    if (listItem) {
      const listType = listItem[1] ? "ol" : "ul";
      if (!activeList || activeListType !== listType) {
        activeList = document.createElement(listType);
        activeListType = listType;
        fragment.append(activeList);
      }
      const item = document.createElement("li");
      appendInlineText(item, listItem[2]);
      activeList.append(item);
      return;
    }

    activeList = null;
    activeListType = "";
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, value);
    fragment.append(paragraph);
  });

  output.replaceChildren(fragment);
}

function renderResult(job, provider) {
  $("#result-title").textContent = job.title || "Resumo do seu vídeo";
  renderSummary(job.summary || "");
  $("#result-provider").textContent = provider === "gemini" ? "GEMINI" : "GROQ";
  $("#copy-summary").onclick = async () => {
    try {
      await navigator.clipboard.writeText(job.summary || "");
      showToast("Resumo copiado para a área de transferência.");
    } catch {
      showToast("Não foi possível copiar. Selecione e copie o texto.");
    }
  };
  $("#download-transcript").onclick = () => {
    const safeTitle = (job.title || "transcricao")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70);
    saveTextFile(job.transcript || "", `${safeTitle || "transcricao"}.txt`);
  };
  setPanel("content");
  setLoading(false);
}

async function pollJob(jobId, provider) {
  setPanel("progress");
  let wait = 1400;

  while (true) {
    await new Promise((resolve) => window.setTimeout(resolve, wait));
    let response;
    try {
      response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      showError("A conexão foi interrompida. Atualize a página para tentar novamente.");
      return;
    }

    if (!response.ok) {
      showError("Não encontramos esta tarefa. Inicie um novo resumo.");
      return;
    }
    const job = await response.json();
    updateProgress(job);

    if (job.status === "completed") {
      renderResult(job, provider);
      showToast("Resumo concluído. Boa descoberta!");
      return;
    }
    if (job.status === "failed") {
      showError(job.message);
      return;
    }
    wait = Math.min(2500, wait + 180);
  }
}

function setupForm(getProvider) {
  const form = $("#summary-form");
  const modelButton = $("#load-models");

  modelButton.addEventListener("click", async () => {
    const apiKey = $("#api-key").value.trim();
    if (!apiKey) {
      showToast("Cole sua chave de API antes de buscar os modelos.");
      $("#api-key").focus();
      return;
    }

    modelButton.disabled = true;
    modelButton.textContent = "Consultando…";
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ provider: getProvider(), api_key: apiKey }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data.detail || "Não foi possível consultar os modelos.");
        return;
      }
      const models = Array.isArray(data.models) ? data.models : [];
      const suggestions = $("#model-options");
      suggestions.replaceChildren(
        ...models.map((model) => {
          const option = document.createElement("option");
          option.value = model;
          return option;
        }),
      );
      if (!models.length) {
        showToast("Nenhum modelo compatível foi encontrado para esta chave.");
        return;
      }
      const currentModel = $("#model-id").value;
      if (!models.includes(currentModel)) {
        const preferred =
          models.find((model) => model.toLowerCase().includes("llama")) || models[0];
        $("#model-id").value = preferred;
      }
      showToast(`${models.length} modelos disponíveis carregados.`);
    } catch {
      showToast("Não foi possível conectar ao servidor.");
    } finally {
      modelButton.disabled = false;
      modelButton.textContent = "Buscar modelos";
    }
  });

  $("#toggle-key").addEventListener("click", () => {
    const input = $("#api-key");
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    $("#toggle-key").setAttribute(
      "aria-label",
      visible ? "Ocultar chave de API" : "Mostrar chave de API",
    );
  });

  $("#retry-button").addEventListener("click", () => {
    setPanel("empty");
    $("#video-url").focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const provider = getProvider();
    const payload = {
      url: $("#video-url").value.trim(),
      provider,
      api_key: $("#api-key").value,
      model: $("#model-id").value.trim(),
      language: $("#language").value,
      whisper_model: $("#whisper-model").value,
      consent: $("#consent").checked,
    };

    setLoading(true);
    setPanel("progress");
    updateProgress({
      stage: "queued",
      progress: 3,
      message: "Preparando sua tarefa segura",
    });

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      // Remove a credencial da interface assim que a API aceitar a tarefa.
      if (response.ok) $("#api-key").value = "";
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(data.detail || "Confira os dados e tente novamente.");
        return;
      }
      await pollJob(data.id, provider);
    } catch {
      $("#api-key").value = "";
      showError("Não foi possível conectar ao servidor. Tente novamente.");
    }
  });
}

function setupTranscriptParallax() {
  if (reducedMotion) return;
  const scene = $(".hero-art");
  const labels = $$("[data-float]", scene);
  if (!labels.length) return;

  scene.addEventListener(
    "pointermove",
    (event) => {
      const rect = scene.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      labels.forEach((label) => {
        const strength = Number(label.dataset.float);
        label.style.marginLeft = `${x * strength * -100}px`;
        label.style.marginTop = `${y * strength * -100}px`;
      });
    },
    { passive: true },
  );
  scene.addEventListener("pointerleave", () => {
    labels.forEach((label) => {
      label.style.marginLeft = "";
      label.style.marginTop = "";
    });
  });
}

function setupTransitions() {
  const links = $$('a[href^="#"]');
  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      if (!reducedMotion && document.startViewTransition) {
        document.startViewTransition(() => {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else {
        target.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
      }
    });
  });
}

setupMotion();
setupWebGL();
setupCursorAndMagnetics();
setupTranscriptParallax();
setupTransitions();
const getProvider = setupProviderPicker();
setupForm(getProvider);
$("#year").textContent = new Date().getFullYear();
