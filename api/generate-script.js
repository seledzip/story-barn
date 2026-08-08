// Vercel Serverless Function (Node.js runtime)
// 이 파일은 서버에서만 실행되므로, ANTHROPIC_API_KEY가 브라우저에 노출되지 않습니다.
// Vercel 대시보드 > Project Settings > Environment Variables 에 ANTHROPIC_API_KEY를 등록해야 합니다.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST 요청만 허용됩니다." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
    return;
  }

  const { contentType, topic, context } = req.body || {};
  if (!topic || !String(topic).trim()) {
    res.status(400).json({ error: "topic이 비어 있습니다." });
    return;
  }

  const system = `당신은 대한민국 시니어(55~75세) 시청자를 타겟으로 하는 유튜브 롱폼 채널의 전문 작가입니다. 이 시청자층은 차분하고 신뢰감 있는 톤, 쉬운 어휘, 과장되지 않은 진솔한 이야기를 선호하며 자극적인 클릭베이트보다 공감과 신뢰를 우선합니다. 반드시 아래 JSON 형식으로만 응답하고, JSON 외의 다른 텍스트나 코드블록 표시는 절대 포함하지 마세요.
{"title_options": ["", "", ""], "hook_script": "", "scene_outline": [{"scene": "1", "description": ""}], "factcheck_notes": ["", ""], "thumbnail_texts": ["", "", ""]}`;

  const trimmedContext = context && String(context).trim() ? String(context).trim().slice(0, 1500) : "";

  const userMsg = `콘텐츠 유형: ${contentType || ""}\n소재/주제: ${topic}\n${trimmedContext ? "참고 내용: " + trimmedContext : ""}

위 소재로 시니어 타겟 유튜브 영상 기획안을 JSON으로 작성해줘. hook_script는 실제 방송에서 그대로 읽을 수 있는 인트로 대본(200~350자)으로 작성하고, scene_outline은 5~7개 장면으로 구성해줘. factcheck_notes에는 방영 전 사실 확인이 필요한 주장을 나열해줘. thumbnail_texts는 클릭을 부르되 과장되지 않은 문구 3개로 작성해줘. 반드시 완결된 JSON 하나만 출력하고, 다른 설명이나 마크다운은 절대 포함하지 마.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || "Anthropic API 오류" });
      return;
    }

    if (data.stop_reason === "max_tokens") {
      res.status(502).json({ error: "응답이 너무 길어 잘렸습니다. 참고 내용을 좀 더 짧게 줄여서 다시 시도해주세요." });
      return;
    }

    const text = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    let clean = text.replace(/^```json\s*|^```\s*|```\s*$/gm, "").trim();

    // 앞뒤에 설명 문구가 섞여 있을 경우, 첫 '{' 부터 마지막 '}' 까지만 추출
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      res.status(502).json({ error: "AI 응답을 해석하지 못했습니다. 다시 시도해주세요." });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message || "알 수 없는 오류가 발생했습니다." });
  }
};
