// Supabase Edge Function: 브라우저 대신 이 함수가 Anthropic API를 호출한다.
// ANTHROPIC_API_KEY는 Supabase 프로젝트의 함수 secret에만 존재하며 클라이언트에 노출되지 않는다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 15000;
const ALLOWED_MODELS = ["claude-sonnet-5", "claude-haiku-4-5"];

const SYSTEM_PROMPT = `너는 소비 재판을 진행하는 AI 판사 시스템이다. 사용자가 제시한 소비 건에 대해 검사(기소), 변호인(변호), 판사 세 관점을 모두 생성해 판결한다.

- 검사 논고와 변호인 변론은 둘 다 실질적인 근거를 가진 주장이어야 한다. 한쪽을 허수아비로 만들지 마라.
- 최종 판결은 검사와 변호인의 논리를 실제로 저울질한 결과여야 하며, 기계적으로 유죄/무죄를 정하지 마라.
- 어조는 한국어로, 재치있고 팩폭(사실을 근거로 날카롭게 지적하는) 스타일을 쓰되, 인신공격이나 모욕은 하지 마라.
- punchline_quote는 한 문장으로 강렬하게 마무리하는 말이다.
- 유죄일 경우에만 alternative_suggestion을 채우고, 무죄일 경우 null로 둔다.`;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    case_summary: { type: "string", description: "사건 개요 - 1~2문장으로 이 소비 건을 중립적으로 요약" },
    prosecution_argument: { type: "string", description: "검사 논고 - 이 소비가 낭비인 이유" },
    defense_argument: { type: "string", description: "변호인 변론 - 이 소비가 합리적/필요한 이유" },
    verdict: { type: "string", enum: ["무죄", "유죄"] },
    verdict_reasoning: { type: "string", description: "최종 판결 요지, 2~4문장" },
    punchline_quote: { type: "string", description: "한 줄 팩폭 명언" },
    alternative_suggestion: {
      type: ["string", "null"],
      description: "유죄일 때 대안 제안. 무죄면 null",
    },
  },
  required: [
    "case_summary",
    "prosecution_argument",
    "defense_argument",
    "verdict",
    "verdict_reasoning",
    "punchline_quote",
    "alternative_suggestion",
  ],
  additionalProperties: false,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildUserContent({ itemName, price, category, reason }) {
  const lines = [
    `품목명: ${itemName}`,
    `가격: ${price.toLocaleString("ko-KR")}원`,
  ];
  if (category) lines.push(`카테고리: ${category}`);
  if (reason) lines.push(`구매 이유/변명: ${reason}`);
  lines.push("", "위 소비 건에 대해 재판을 진행해줘.");
  return lines.join("\n");
}

function buildRequestBody({ itemName, price, category, reason, model }) {
  return {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildUserContent({ itemName, price, category, reason }) },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: VERDICT_SCHEMA,
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed", message: "POST 요청만 지원해요." }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "server_misconfigured", message: "ANTHROPIC_API_KEY가 설정되지 않았어요." }, 500);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_input", message: "요청 형식이 올바르지 않아요." }, 400);
  }

  const { itemName, price, category, reason, model } = payload || {};

  if (typeof itemName !== "string" || itemName.trim() === "" || typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return jsonResponse({ error: "invalid_input", message: "품목명과 가격을 확인해주세요." }, 400);
  }

  const requestBody = buildRequestBody({
    itemName,
    price,
    category: typeof category === "string" ? category : "",
    reason: typeof reason === "string" ? reason : "",
    model: ALLOWED_MODELS.includes(model) ? model : ALLOWED_MODELS[0],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const code = err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
    return jsonResponse({ error: code, message: "Anthropic 서버 응답이 지연되고 있어요." }, 504);
  }
  clearTimeout(timeoutId);

  const data = await anthropicRes.text();
  return new Response(data, {
    status: anthropicRes.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
