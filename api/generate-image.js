// Vercel Serverless Function (Node.js runtime)
// Replicate의 Flux 모델로 장면 이미지를 생성합니다.
// REPLICATE_API_TOKEN 환경변수가 Vercel 프로젝트 설정에 등록되어 있어야 합니다.
// 로컬 HTML 파일(그림책방.html)에서 호출하므로 CORS를 열어둡니다.

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST 요청만 허용됩니다." });
    return;
  }

  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    res.status(500).json({ error: "서버에 REPLICATE_API_TOKEN 환경변수가 설정되지 않았습니다." });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || !String(prompt).trim()) {
    res.status(400).json({ error: "prompt가 비어 있습니다." });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  let imagePrompt = String(prompt).trim();

  // 1단계: 대본 문장을 "시니어 다큐멘터리 사진" 스타일의 정확한 영어 프롬프트로 변환
  // (한국어 프롬프트는 이미지 생성 모델이 잘 이해하지 못하고, 기획 노트 말투("~를 보여준다")도
  //  그대로 넣으면 엉뚱한 결과가 나오기 때문입니다.)
  if (anthropicKey) {
    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 200,
          system:
            "You convert Korean YouTube scene-planning notes into a short English image-generation prompt for a realistic documentary-style photo. Unless the scene text clearly says otherwise, the subject should be a Korean senior citizen (60s-70s), photographed respectfully and authentically — never a young person, never a K-drama or fashion-model style portrait. Describe one concrete visual moment (setting, subject, action, mood, lighting) in under 40 words. Output ONLY the prompt text, nothing else — no quotes, no explanation, no markdown.",
          messages: [{ role: "user", content: `장면 설명: ${imagePrompt}` }],
        }),
      });
      const claudeData = await claudeRes.json();
      const text = (claudeData.content || [])
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      if (text) imagePrompt = text;
    } catch (e) {
      // 실패하면 원문 텍스트로 그대로 진행합니다.
    }
  }

  const fullPrompt = `${imagePrompt}. Realistic documentary photography, warm natural lighting, dignified and authentic, no text, no watermark, no logo.`;

  try {
    const predictionRes = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            prompt: fullPrompt,
            aspect_ratio: "16:9",
            output_format: "jpg",
          },
        }),
      }
    );

    const prediction = await predictionRes.json();

    if (!predictionRes.ok) {
      res.status(predictionRes.status).json({ error: prediction.detail || "Replicate API 오류" });
      return;
    }

    let outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) {
      res.status(504).json({ error: "이미지 생성이 시간 내에 끝나지 않았습니다. 다시 시도해주세요." });
      return;
    }

    // 이미지를 서버에서 대신 받아 base64로 변환 (브라우저 캔버스에서 안전하게 쓰기 위함)
    const imgRes = await fetch(outputUrl);
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";

    res.status(200).json({ imageDataUrl: `data:${contentType};base64,${base64}` });
  } catch (e) {
    res.status(500).json({ error: e.message || "알 수 없는 오류가 발생했습니다." });
  }
};
