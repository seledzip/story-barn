// ---------- 설정 ----------
const CONTENT_TYPES = ["감동·효도 사연", "건강 정보", "노후 경제", "추억 이야기", "시사 해설"];
const PATCH_COLORS = ["#B8860B", "#A6552E", "#33415C", "#4F6B54"];
function patchColor(i) { return PATCH_COLORS[i % PATCH_COLORS.length]; }

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtNum(n) {
  if (n === null || n === undefined) return "-";
  const num = Number(n);
  if (num >= 10000) return (num / 10000).toFixed(1).replace(/\.0$/, "") + "만";
  return num.toLocaleString("ko-KR");
}

function parseChannelInput(raw) {
  let s = raw.trim();
  const urlMatch = s.match(/youtube\.com\/(channel\/|@)([^/?#\s]+)/i);
  if (urlMatch) {
    return urlMatch[1].startsWith("channel") ? { type: "id", value: urlMatch[2] } : { type: "handle", value: urlMatch[2] };
  }
  if (s.startsWith("@")) return { type: "handle", value: s.slice(1) };
  if (/^UC[\w-]{20,}$/.test(s)) return { type: "id", value: s };
  return { type: "handle", value: s.replace(/^@/, "") };
}

async function ytFetch(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "YouTube API 오류");
  return data;
}

async function fetchChannelWithVideos(parsed, apiKey) {
  const base = "https://www.googleapis.com/youtube/v3";
  const chUrl = parsed.type === "id"
    ? `${base}/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(parsed.value)}&key=${apiKey}`
    : `${base}/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(parsed.value)}&key=${apiKey}`;
  const chData = await ytFetch(chUrl);
  if (!chData.items || chData.items.length === 0) throw new Error("채널을 찾을 수 없습니다.");
  const ch = chData.items[0];
  const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads;
  const subs = Number(ch.statistics?.subscriberCount || 0);

  let videos = [];
  if (uploadsId) {
    const plUrl = `${base}/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=10&key=${apiKey}`;
    const plData = await ytFetch(plUrl);
    const videoIds = (plData.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
    if (videoIds.length > 0) {
      const vUrl = `${base}/videos?part=statistics,snippet&id=${videoIds.join(",")}&key=${apiKey}`;
      const vData = await ytFetch(vUrl);
      videos = (vData.items || []).map((v) => {
        const views = Number(v.statistics?.viewCount || 0);
        const ratio = subs > 0 ? views / subs : 0;
        return { id: v.id, title: v.snippet?.title || "(제목 없음)", views, ratio, url: `https://www.youtube.com/watch?v=${v.id}` };
      });
      videos.sort((a, b) => b.ratio - a.ratio);
    }
  }
  return { id: ch.id, title: ch.snippet?.title || parsed.value, subscriberCount: subs, videos, fetchedAt: Date.now() };
}

// 자체 서버(/api/generate-script)를 통해 Anthropic API 호출 (API 키는 서버에만 존재)
async function generateScriptViaAPI(contentType, topic, context) {
  const res = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType, topic, context }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `서버 오류 (${res.status})`);
  }
  return res.json();
}

// ---------- 저장소 ----------
function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error(e); } }

// ---------- 상태 ----------
const state = {
  tab: "discover",
  apiKey: loadJSON("yt-api-key", ""),
  keyInput: "",
  channelInput: "",
  channels: loadJSON("channels", []),
  discoverLoading: false,
  discoverError: "",
  contentType: CONTENT_TYPES[0],
  topic: "",
  context: "",
  genLoading: false,
  genError: "",
  script: null,
  saved: loadJSON("scripts", []),
};

function setState(patch) { Object.assign(state, patch); render(); }

// ---------- 렌더링 ----------
function render() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="wrap">
      <div class="brand-row">
        <h1 class="brand">이야기 곳간</h1>
        <span class="brand-sub">시니어 타겟 유튜브 소재·대본 자동화</span>
      </div>
      <p class="tagline">떡상 소재를 거둬들이고(탐색), AI로 대본을 짓고(짓기), 곳간에 쌓아두세요(보관함).</p>

      <div class="tabs">
        <button class="tab-btn ${state.tab === "discover" ? "active" : ""}" data-tab="discover">소재 탐색</button>
        <button class="tab-btn ${state.tab === "write" ? "active" : ""}" data-tab="write">대본 짓기</button>
        <button class="tab-btn ${state.tab === "saved" ? "active" : ""}" data-tab="saved">보관함 (${state.saved.length})</button>
      </div>

      <div id="tab-content"></div>
    </div>
  `;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setState({ tab: btn.dataset.tab }));
  });

  const content = document.getElementById("tab-content");
  if (state.tab === "discover") content.innerHTML = renderDiscover();
  else if (state.tab === "write") content.innerHTML = renderWrite();
  else content.innerHTML = renderSaved();

  attachTabHandlers();
}

function renderDiscover() {
  let html = "";
  if (!state.apiKey) {
    html += `
      <div class="card">
        <span class="patch" style="background:${patchColor(0)}">1단계</span>
        <p style="margin-top:10px;font-size:13.5px;line-height:1.6;color:var(--ink-soft)">
          채널 탐색을 사용하려면 <strong>YouTube Data API 키</strong>가 필요합니다. Google Cloud Console에서 무료로 발급받을 수 있습니다.
        </p>
        <div class="row">
          <input type="text" id="key-input" placeholder="YouTube Data API 키 붙여넣기" value="${esc(state.keyInput)}" />
          <button class="btn" id="save-key-btn">저장</button>
        </div>
      </div>`;
  } else {
    html += `
      <div class="card">
        <span class="patch" style="background:${patchColor(0)}">채널 등록</span>
        <div class="row">
          <input type="text" id="channel-input" placeholder="채널 URL, @핸들, 또는 채널ID" value="${esc(state.channelInput)}" />
          <button class="btn" id="add-channel-btn" ${state.discoverLoading ? "disabled" : ""}>${state.discoverLoading ? "불러오는 중…" : "추가"}</button>
        </div>
        ${state.discoverError ? `<p class="error-text">${esc(state.discoverError)}</p>` : ""}
        <p class="hint">예시 검색 키워드: 효도 사연, 노후 준비, 옛날이야기, 건강 정보, 시니어 뉴스해설</p>
      </div>`;

    if (state.channels.length === 0) {
      html += `<div class="card center">아직 등록된 채널이 없습니다. 시니어 타겟 채널을 추가하면 구독자 대비 조회수가 높은 영상을 자동으로 찾아드립니다.</div>`;
    }

    state.channels.forEach((ch, ci) => {
      html += `
        <div class="card">
          <div class="channel-header">
            <div>
              <div class="channel-title">${esc(ch.title)}</div>
              <div class="channel-sub">구독자 ${fmtNum(ch.subscriberCount)}명</div>
            </div>
            <div class="row" style="margin-top:0">
              <button class="btn ghost small" data-refresh="${ch.id}">새로고침</button>
              <button class="btn ghost small danger" data-remove="${ch.id}">삭제</button>
            </div>
          </div>
          <div>
            ${ch.videos.length === 0 ? `<div class="hint">최근 영상을 찾을 수 없습니다.</div>` : ""}
            ${ch.videos.map((v) => `
              <div class="video-row">
                ${v.ratio >= 1 ? `<div class="ratio-badge ${v.ratio >= 5 ? "hot" : ""}">${v.ratio.toFixed(1)}x</div>` : `<div style="width:46px"></div>`}
                <div class="video-info">
                  <a class="video-title" href="${esc(v.url)}" target="_blank" rel="noreferrer">${esc(v.title)}</a>
                  <div class="video-meta">조회수 ${fmtNum(v.views)}회</div>
                </div>
                <button class="btn ghost small" data-use-topic="${esc(v.title)}">대본 짓기</button>
              </div>
            `).join("")}
          </div>
        </div>`;
    });
  }
  return html;
}

function renderWrite() {
  let html = `
    <div class="card">
      <span class="patch" style="background:${patchColor(2)}">기획 입력</span>
      <div class="field" style="margin-top:12px">
        <label class="field-label">콘텐츠 유형</label>
        <select id="content-type">
          ${CONTENT_TYPES.map((t) => `<option value="${esc(t)}" ${t === state.contentType ? "selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label class="field-label">소재 / 주제</label>
        <input type="text" id="topic-input" placeholder="예: 6070세대가 겪은 물가 변화 이야기" value="${esc(state.topic)}" />
      </div>
      <div class="field">
        <label class="field-label">참고 내용 (선택 — 기사, 사실관계, 인터뷰 요약 등)</label>
        <textarea id="context-input" rows="4">${esc(state.context)}</textarea>
      </div>
      <button class="btn" id="generate-btn" ${state.genLoading || !state.topic.trim() ? "disabled" : ""}>${state.genLoading ? "짓는 중…" : "대본 기획안 만들기"}</button>
      ${state.genError ? `<p class="error-text">${esc(state.genError)}</p>` : ""}
    </div>`;

  if (state.script) {
    html += `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="patch" style="background:${patchColor(3)}">기획안</span>
          <div class="row" style="margin-top:0">
            <button class="btn" id="save-script-btn" style="padding:6px 12px;font-size:12px">곳간에 저장</button>
          </div>
        </div>
        ${renderScriptBody(state.script)}
      </div>`;
  }
  return html;
}

function renderScriptBody(s) {
  return `
    <div class="section-title">제목 후보</div>
    <ul class="plain">${(s.title_options || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    <div class="section-title">훅 대본 (인트로)</div>
    <p class="hook-box">${esc(s.hook_script)}</p>
    <div class="section-title">장면 개요</div>
    <ol class="plain">${(s.scene_outline || []).map((sc) => `<li><strong>${esc(sc.scene)}.</strong> ${esc(sc.description)}</li>`).join("")}</ol>
    <div class="section-title">사실 확인 필요 항목</div>
    <ul class="plain">${(s.factcheck_notes || []).map((f) => `<li style="color:var(--rust)">${esc(f)}</li>`).join("")}</ul>
    <div class="section-title">썸네일 문구</div>
    <div>${(s.thumbnail_texts || []).map((t) => `<span class="thumb-chip">${esc(t)}</span>`).join("")}</div>
  `;
}

function renderSaved() {
  if (state.saved.length === 0) {
    return `<div class="card center">아직 곳간이 비어 있습니다. 대본 짓기 탭에서 기획안을 만들고 저장해보세요.</div>`;
  }
  return state.saved.map((s, i) => `
    <div class="card">
      <div class="channel-header">
        <div>
          <span class="patch" style="background:${patchColor(i)}">${esc(s.contentType)}</span>
          <div class="channel-title" style="margin-top:8px">${esc(s.topic)}</div>
          <div class="hint">${new Date(s.savedAt).toLocaleString("ko-KR")}</div>
        </div>
        <button class="btn ghost small danger" data-delete-saved="${i}">삭제</button>
      </div>
      ${renderScriptBody(s)}
    </div>
  `).join("");
}

function attachTabHandlers() {
  // 소재 탐색
  const keyInput = document.getElementById("key-input");
  if (keyInput) keyInput.addEventListener("input", (e) => (state.keyInput = e.target.value));
  const saveKeyBtn = document.getElementById("save-key-btn");
  if (saveKeyBtn) saveKeyBtn.addEventListener("click", () => {
    if (!state.keyInput.trim()) return;
    state.apiKey = state.keyInput.trim();
    saveJSON("yt-api-key", state.apiKey);
    state.keyInput = "";
    render();
  });

  const channelInput = document.getElementById("channel-input");
  if (channelInput) {
    channelInput.addEventListener("input", (e) => (state.channelInput = e.target.value));
    channelInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addChannel(); });
  }
  const addBtn = document.getElementById("add-channel-btn");
  if (addBtn) addBtn.addEventListener("click", addChannel);

  document.querySelectorAll("[data-refresh]").forEach((btn) => {
    btn.addEventListener("click", () => refreshChannel(btn.dataset.refresh));
  });
  document.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.channels = state.channels.filter((c) => c.id !== btn.dataset.remove);
      saveJSON("channels", state.channels);
      render();
    });
  });
  document.querySelectorAll("[data-use-topic]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.topic = btn.dataset.useTopic;
      state.script = null;
      state.tab = "write";
      render();
    });
  });

  // 대본 짓기
  const ct = document.getElementById("content-type");
  if (ct) ct.addEventListener("change", (e) => (state.contentType = e.target.value));
  const topicInput = document.getElementById("topic-input");
  if (topicInput) topicInput.addEventListener("input", (e) => {
    state.topic = e.target.value;
    document.getElementById("generate-btn").disabled = state.genLoading || !state.topic.trim();
  });
  const contextInput = document.getElementById("context-input");
  if (contextInput) contextInput.addEventListener("input", (e) => (state.context = e.target.value));
  const genBtn = document.getElementById("generate-btn");
  if (genBtn) genBtn.addEventListener("click", handleGenerate);
  const saveScriptBtn = document.getElementById("save-script-btn");
  if (saveScriptBtn) saveScriptBtn.addEventListener("click", () => {
    const entry = { ...state.script, topic: state.topic, contentType: state.contentType, savedAt: Date.now() };
    state.saved = [entry, ...state.saved];
    saveJSON("scripts", state.saved);
    render();
  });

  // 보관함
  document.querySelectorAll("[data-delete-saved]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.deleteSaved);
      state.saved = state.saved.filter((_, i) => i !== idx);
      saveJSON("scripts", state.saved);
      render();
    });
  });
}

async function addChannel() {
  if (!state.channelInput.trim() || !state.apiKey) return;
  state.discoverLoading = true;
  state.discoverError = "";
  render();
  try {
    const parsed = parseChannelInput(state.channelInput);
    const ch = await fetchChannelWithVideos(parsed, state.apiKey);
    state.channels = [ch, ...state.channels.filter((c) => c.id !== ch.id)];
    saveJSON("channels", state.channels);
    state.channelInput = "";
  } catch (e) {
    state.discoverError = e.message || "채널을 불러오지 못했습니다.";
  } finally {
    state.discoverLoading = false;
    render();
  }
}

async function refreshChannel(id) {
  state.discoverLoading = true;
  render();
  try {
    const fresh = await fetchChannelWithVideos({ type: "id", value: id }, state.apiKey);
    state.channels = state.channels.map((c) => (c.id === fresh.id ? fresh : c));
    saveJSON("channels", state.channels);
  } catch (e) {
    state.discoverError = e.message || "새로고침에 실패했습니다.";
  } finally {
    state.discoverLoading = false;
    render();
  }
}

async function handleGenerate() {
  if (!state.topic.trim()) return;
  state.genLoading = true;
  state.genError = "";
  state.script = null;
  render();
  try {
    const result = await generateScriptViaAPI(state.contentType, state.topic, state.context);
    state.script = result;
  } catch (e) {
    state.genError = e.message || "대본 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
  } finally {
    state.genLoading = false;
    render();
  }
}

render();
