// ===== supabaseClient.js: Supabase 프로젝트 연결 =====
const SUPABASE_URL = "https://rljcfahvxxydqkdjekmj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HBSySpMRT8lgJ5BqDt16sA__LEBKn96";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== storage.js: Supabase(verdict_records 테이블) 기반 판결 기록 저장소 =====
const Storage = (() => {
  const TABLE = "verdict_records";

  // camelCase(앱 내부) <-> snake_case(DB 컬럼) 매핑
  const FIELD_MAP = {
    id: "id",
    createdAt: "created_at",
    itemName: "item_name",
    price: "price",
    category: "category",
    reason: "reason",
    verdict: "verdict",
    caseSummary: "case_summary",
    prosecutionArgument: "prosecution_argument",
    defenseArgument: "defense_argument",
    verdictReasoning: "verdict_reasoning",
    punchlineQuote: "punchline_quote",
    savingsAmount: "savings_amount",
    alternativeSuggestion: "alternative_suggestion",
    modelUsed: "model_used",
    interestLevel: "interest_level",
    memo: "memo",
    checklist: "checklist",
  };
  const REVERSE_FIELD_MAP = Object.fromEntries(
    Object.entries(FIELD_MAP).map(([camel, snake]) => [snake, camel])
  );

  function toRow(obj) {
    const row = {};
    for (const [key, value] of Object.entries(obj)) {
      row[FIELD_MAP[key] || key] = value;
    }
    return row;
  }

  function toRecord(row) {
    const record = {};
    for (const [key, value] of Object.entries(row)) {
      record[REVERSE_FIELD_MAP[key] || key] = value;
    }
    return record;
  }

  async function loadRecords() {
    const { data, error } = await supabaseClient
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("판결 기록을 불러오지 못했습니다.", error);
      return [];
    }
    return (data || []).map(toRecord);
  }

  async function addRecord(record) {
    const { data, error } = await supabaseClient
      .from(TABLE)
      .insert(toRow(record))
      .select()
      .single();
    if (error) {
      console.error("판결 기록을 저장하지 못했습니다.", error);
      throw new Error("판결 기록을 저장하지 못했어요.");
    }
    return toRecord(data);
  }

  async function deleteRecord(id) {
    const { error } = await supabaseClient.from(TABLE).delete().eq("id", id);
    if (error) console.error("판결 기록을 삭제하지 못했습니다.", error);
  }

  async function updateRecord(id, patch) {
    const { error } = await supabaseClient.from(TABLE).update(toRow(patch)).eq("id", id);
    if (error) console.error("판결 기록을 수정하지 못했습니다.", error);
  }

  function computeStats(records) {
    const total = records.length;
    const guiltyRecords = records.filter((r) => r.verdict === "유죄");
    const innocentCount = total - guiltyRecords.length;
    const totalSaved = guiltyRecords.reduce((sum, r) => sum + (r.savingsAmount || 0), 0);
    const innocenceRate = total === 0 ? 0 : innocentCount / total;
    return {
      total,
      guiltyCount: guiltyRecords.length,
      innocentCount,
      totalSaved,
      innocenceRate,
    };
  }

  function createId() {
    return "rec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  return { loadRecords, addRecord, deleteRecord, updateRecord, computeStats, createId };
})();

// ===== validation.js: 입력 검증 규칙 =====
const Validation = (() => {
  function validatePrice(rawInput) {
    const cleaned = String(rawInput ?? "").trim().replace(/,/g, "");

    if (cleaned === "") {
      return { valid: false, error: "가격을 입력해주세요." };
    }

    const num = Number(cleaned);

    if (!Number.isFinite(num)) {
      return { valid: false, error: "숫자만 입력해주세요." };
    }

    if (num <= 0) {
      return { valid: false, error: "가격은 0보다 큰 값이어야 해요." };
    }

    return { valid: true, value: Math.round(num) };
  }

  function validateItemName(rawInput) {
    const trimmed = String(rawInput ?? "").trim();
    if (trimmed === "") {
      return { valid: false, error: "품목명을 입력해주세요." };
    }
    return { valid: true, value: trimmed };
  }

  return { validatePrice, validateItemName };
})();

// ===== settings.js: 모델 설정 관리 =====
const Settings = (() => {
  const SETTINGS_KEY = "sojuban.settings.v1";

  function load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { model: "claude-sonnet-5" };
      const parsed = JSON.parse(raw);
      return { model: parsed.model || "claude-sonnet-5" };
    } catch (e) {
      return { model: "claude-sonnet-5" };
    }
  }

  function save(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function open() {
    const modal = document.getElementById("settingsModal");
    const current = load();
    document.getElementById("modelSelect").value = current.model;
    modal.hidden = false;
  }

  function close() {
    document.getElementById("settingsModal").hidden = true;
  }

  function wireUp() {
    document.getElementById("openSettingsBtn").addEventListener("click", open);

    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", close);
    });

    document.getElementById("saveSettingsBtn").addEventListener("click", () => {
      const model = document.getElementById("modelSelect").value;
      save({ model });
      close();
    });
  }

  return { load, save, open, close, wireUp };
})();

// ===== apiClient.js: /api/verdict (Vercel 서버리스 함수) 호출 래퍼 =====
const ApiClient = (() => {
  const API_URL = "/api/verdict";
  const TIMEOUT_MS = 15000;

  class ApiClientError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code; // "timeout" | "network" | "server_misconfigured" | "rate_limit" | "server" | "unknown"
    }
  }

  async function requestVerdict(caseInput) {
    const settings = Settings.load();
    const body = { ...caseInput, model: settings.model };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new ApiClientError("응답이 너무 오래 걸려요. 잠시 후 다시 시도해주세요.", "timeout");
      }
      throw new ApiClientError("네트워크 연결을 확인해주세요.", "network");
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 500) {
        throw new ApiClientError("서버 설정에 문제가 있어요. 관리자에게 문의해주세요.", "server_misconfigured");
      }
      if (response.status === 429) {
        throw new ApiClientError("요청이 너무 많아요. 잠시 후 다시 시도해주세요.", "rate_limit");
      }
      if (response.status >= 500) {
        throw new ApiClientError("Claude 서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.", "server");
      }
      throw new ApiClientError("알 수 없는 오류가 발생했어요.", "unknown");
    }

    const data = await response.json();
    return data;
  }

  return { requestVerdict, ApiClientError };
})();

// ===== verdictParser.js: Claude 응답에서 구조화된 판결 JSON을 안전하게 추출/검증 =====
const VerdictParser = (() => {
  function parse(apiResponse) {
    const textBlock = (apiResponse.content || []).find((b) => b.type === "text");
    if (!textBlock || !textBlock.text) {
      throw new Error("판결문을 생성하지 못했어요. 다시 시도해주세요.");
    }

    let verdictData;
    try {
      verdictData = JSON.parse(textBlock.text);
    } catch (e) {
      throw new Error("판결문 형식이 올바르지 않아요. 다시 시도해주세요.");
    }

    const requiredFields = [
      "case_summary",
      "prosecution_argument",
      "defense_argument",
      "verdict",
      "verdict_reasoning",
      "punchline_quote",
    ];

    for (const field of requiredFields) {
      if (!verdictData[field] || String(verdictData[field]).trim() === "") {
        throw new Error("판결문이 불완전해요. 다시 시도해주세요.");
      }
    }

    if (verdictData.verdict !== "무죄" && verdictData.verdict !== "유죄") {
      throw new Error("판결 결과를 인식하지 못했어요. 다시 시도해주세요.");
    }

    return {
      caseSummary: verdictData.case_summary,
      prosecutionArgument: verdictData.prosecution_argument,
      defenseArgument: verdictData.defense_argument,
      verdict: verdictData.verdict,
      verdictReasoning: verdictData.verdict_reasoning,
      punchlineQuote: verdictData.punchline_quote,
      alternativeSuggestion: verdictData.alternative_suggestion || null,
    };
  }

  return { parse };
})();

// ===== router.js: 상태 기반 화면 전환 라우터 =====
const Router = (() => {
  const VIEW_IDS = ["home", "trial", "result", "history"];

  function showView(name) {
    VIEW_IDS.forEach((id) => {
      const el = document.getElementById(`view-${id}`);
      if (!el) return;
      el.classList.toggle("is-active", id === name);
    });

    if (name === "history" && typeof HistoryView !== "undefined") {
      HistoryView.render();
    }

    window.scrollTo(0, 0);
  }

  function wireUp() {
    document.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        showView(el.dataset.nav);
      });
    });
  }

  return { showView, wireUp };
})();

// ===== homeView.js: 홈/입력 화면 로직 =====
const HomeView = (() => {
  function readForm() {
    const itemNameRaw = document.getElementById("itemNameInput").value;
    const priceRaw = document.getElementById("priceInput").value;
    const category = document.getElementById("categoryInput").value;
    const reason = document.getElementById("reasonInput").value.trim();

    const priceErrorEl = document.getElementById("priceError");
    priceErrorEl.textContent = "";

    const itemCheck = Validation.validateItemName(itemNameRaw);
    if (!itemCheck.valid) {
      alert(itemCheck.error);
      return null;
    }

    const priceCheck = Validation.validatePrice(priceRaw);
    if (!priceCheck.valid) {
      priceErrorEl.textContent = priceCheck.error;
      return null;
    }

    return {
      itemName: itemCheck.value,
      price: priceCheck.value,
      category,
      reason,
    };
  }

  function resetForm() {
    document.getElementById("caseForm").reset();
    document.getElementById("priceError").textContent = "";
  }

  function wireUp() {
    document.getElementById("caseForm").addEventListener("submit", (e) => {
      e.preventDefault();

      const caseInput = readForm();
      if (!caseInput) return;

      Router.showView("trial");
      TrialView.startTrial(caseInput);
    });
  }

  return { wireUp, resetForm };
})();

// ===== trialView.js: 재판 진행(로딩) 화면 로직 - API 호출 오케스트레이션 =====
const TrialView = (() => {
  let currentTrialToken = 0;

  const STATUS_MESSAGES = [
    "판사님 입장 중...",
    "검사와 변호인 신문 준비 중...",
    "증거 검토 중...",
    "판결문 작성 중...",
  ];

  function cycleStatusMessages(token) {
    let i = 0;
    const el = document.getElementById("trialStatusText");
    const interval = setInterval(() => {
      if (token !== currentTrialToken) {
        clearInterval(interval);
        return;
      }
      i = (i + 1) % STATUS_MESSAGES.length;
      el.textContent = STATUS_MESSAGES[i];
    }, 1800);
  }

  async function startTrial(caseInput) {
    const token = ++currentTrialToken;
    document.getElementById("trialStatusText").textContent = STATUS_MESSAGES[0];
    cycleStatusMessages(token);

    try {
      const apiResponse = await ApiClient.requestVerdict(caseInput);

      if (token !== currentTrialToken) return; // 취소되었거나 새 재판이 시작됨

      const verdict = VerdictParser.parse(apiResponse);
      const savingsAmount = verdict.verdict === "유죄" ? caseInput.price : 0;

      const record = {
        id: Storage.createId(),
        createdAt: new Date().toISOString(),
        itemName: caseInput.itemName,
        price: caseInput.price,
        category: caseInput.category,
        reason: caseInput.reason,
        verdict: verdict.verdict,
        caseSummary: verdict.caseSummary,
        prosecutionArgument: verdict.prosecutionArgument,
        defenseArgument: verdict.defenseArgument,
        verdictReasoning: verdict.verdictReasoning,
        punchlineQuote: verdict.punchlineQuote,
        savingsAmount,
        alternativeSuggestion: verdict.alternativeSuggestion,
        modelUsed: Settings.load().model,
      };

      await Storage.addRecord(record);
      ResultView.render(record);
      Router.showView("result");
    } catch (err) {
      if (token !== currentTrialToken) return;
      const message = err.message || "알 수 없는 오류가 발생했어요.";
      alert(message);
      Router.showView("home");
    }
  }

  function cancelTrial() {
    currentTrialToken++; // 진행 중인 요청 결과를 무시하도록 토큰 무효화
    Router.showView("home");
  }

  function wireUp() {
    document.getElementById("cancelTrialBtn").addEventListener("click", cancelTrial);
  }

  return { startTrial, wireUp };
})();

// ===== resultView.js: 판결 결과 화면 로직 =====
const ResultView = (() => {
  let currentRecord = null;

  function formatWon(amount) {
    return amount.toLocaleString("ko-KR") + "원";
  }

  function render(record) {
    currentRecord = record;

    const badge = document.getElementById("verdictBadge");
    badge.textContent = record.verdict;
    badge.className = "verdict-badge " + (record.verdict === "무죄" ? "innocent" : "guilty");

    document.getElementById("resultItemName").textContent = record.itemName;
    document.getElementById("resultPrice").textContent = formatWon(record.price);

    document.getElementById("caseSummary").textContent = record.caseSummary;
    document.getElementById("prosecutionArgument").textContent = record.prosecutionArgument;
    document.getElementById("defenseArgument").textContent = record.defenseArgument;
    document.getElementById("verdictReasoning").textContent = record.verdictReasoning;
    document.getElementById("punchlineQuote").textContent = "“" + record.punchlineQuote + "”";

    const savingsSection = document.getElementById("savingsSection");
    if (record.verdict === "유죄") {
      savingsSection.hidden = false;
      document.getElementById("savingsAmount").textContent = formatWon(record.savingsAmount) + " 절약 가능!";
      document.getElementById("alternativeSuggestion").textContent = record.alternativeSuggestion || "";
    } else {
      savingsSection.hidden = true;
    }
  }

  function wireUp() {
    document.getElementById("retryBtn").addEventListener("click", () => {
      HomeView.resetForm();
      Router.showView("home");
    });

    document.getElementById("viewHistoryBtn").addEventListener("click", () => {
      Router.showView("history");
    });

    document.getElementById("shareBtn").addEventListener("click", () => {
      if (currentRecord) {
        ShareCard.generateAndDownload(currentRecord);
      }
    });
  }

  return { render, wireUp };
})();

// ===== historyView.js: 마이페이지(판결 기록) 화면 로직 =====
const HistoryView = (() => {
  let currentFilter = "all";

  const DEFAULT_CHECKLIST = [
    { id: "c1", label: "이미 비슷한 걸 갖고 있지 않나요?" },
    { id: "c2", label: "이 돈으로 더 필요한 걸 살 수는 없나요?" },
    { id: "c3", label: "지금 아니어도 일주일 뒤에 사도 되나요?" },
    { id: "c4", label: "이번 달 예산 안에서 감당 가능한가요?" },
    { id: "c5", label: "광고나 세일 문구에 홀린 건 아닌가요?" },
  ];

  function formatWon(amount) {
    return Math.round(amount).toLocaleString("ko-KR") + "원";
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }

  // 기존(마이그레이션 전) 기록에는 interestLevel/memo/checklist가 없을 수 있으므로 기본값 적용
  // DB의 checklist 기본값은 빈 배열([])이므로, 비어있으면 기본 체크리스트로 채운다.
  function withDefaults(record) {
    const hasChecklist = Array.isArray(record.checklist) && record.checklist.length > 0;
    return {
      interestLevel: 50,
      memo: "",
      ...record,
      checklist: hasChecklist ? record.checklist : DEFAULT_CHECKLIST.map((i) => ({ ...i, checked: false })),
    };
  }

  function renderStats(records) {
    const stats = Storage.computeStats(records);
    document.getElementById("statTotalSaved").textContent = formatWon(stats.totalSaved);
    document.getElementById("statInnocenceRate").textContent = Math.round(stats.innocenceRate * 100) + "%";
    document.getElementById("statTotalCount").textContent = stats.total + "건";
  }

  function buildDetailPanel(record) {
    const detail = document.createElement("div");
    detail.className = "history-item__detail";

    // 체크리스트
    const checklistEl = document.createElement("ul");
    checklistEl.className = "checklist-list checklist-list--compact";

    record.checklist.forEach((item) => {
      const li = document.createElement("li");
      li.className = "checklist-item" + (item.checked ? " is-done" : "");

      const label = document.createElement("label");
      label.className = "checklist-item__label";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(item.checked);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", async () => {
        const updatedChecklist = record.checklist.map((c) =>
          c.id === item.id ? { ...c, checked: checkbox.checked } : c
        );
        record.checklist = updatedChecklist;
        li.classList.toggle("is-done", checkbox.checked);
        await Storage.updateRecord(record.id, { checklist: updatedChecklist });
      });

      const text = document.createElement("span");
      text.textContent = item.label;

      label.appendChild(checkbox);
      label.appendChild(text);
      li.appendChild(label);
      checklistEl.appendChild(li);
    });

    // 메모
    const memoLabel = document.createElement("p");
    memoLabel.className = "history-item__memo-label";
    memoLabel.textContent = "메모";

    const memoInput = document.createElement("textarea");
    memoInput.className = "dashboard-input history-item__memo";
    memoInput.rows = 2;
    memoInput.maxLength = 300;
    memoInput.placeholder = "이 소비에 대한 메모를 남겨보세요";
    memoInput.value = record.memo || "";
    memoInput.addEventListener("click", (e) => e.stopPropagation());
    memoInput.addEventListener("blur", async () => {
      await Storage.updateRecord(record.id, { memo: memoInput.value });
    });

    detail.appendChild(checklistEl);
    detail.appendChild(memoLabel);
    detail.appendChild(memoInput);

    return detail;
  }

  function renderList(records) {
    const listEl = document.getElementById("historyList");
    const emptyEl = document.getElementById("historyEmptyState");

    const withDefaultsApplied = records.map(withDefaults);

    // 관심도 높은 순 정렬 (동점이면 기존 순서 유지)
    const sorted = withDefaultsApplied.slice().sort((a, b) => b.interestLevel - a.interestLevel);

    const filtered = currentFilter === "all"
      ? sorted
      : sorted.filter((r) => r.verdict === currentFilter);

    listEl.innerHTML = "";

    if (filtered.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    filtered.forEach((record) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const row = document.createElement("div");
      row.className = "history-item__row";

      const badge = document.createElement("span");
      badge.className = "history-item__badge " + (record.verdict === "무죄" ? "innocent" : "guilty");
      badge.textContent = record.verdict;

      const body = document.createElement("div");
      body.className = "history-item__body";

      const title = document.createElement("div");
      title.className = "history-item__title";
      title.textContent = record.itemName;

      const meta = document.createElement("div");
      meta.className = "history-item__meta";
      meta.textContent = `${formatDate(record.createdAt)} · ${formatWon(record.price)}`;

      body.appendChild(title);
      body.appendChild(meta);

      // 관심도 드래그바
      const interestWrap = document.createElement("div");
      interestWrap.className = "history-item__interest";

      const interestLabel = document.createElement("span");
      interestLabel.className = "history-item__interest-value";
      interestLabel.textContent = "관심도 " + record.interestLevel;

      const interestSlider = document.createElement("input");
      interestSlider.type = "range";
      interestSlider.min = "0";
      interestSlider.max = "100";
      interestSlider.value = String(record.interestLevel);
      interestSlider.className = "history-item__interest-slider";
      interestSlider.addEventListener("click", (e) => e.stopPropagation());
      interestSlider.addEventListener("input", () => {
        interestLabel.textContent = "관심도 " + interestSlider.value;
      });
      interestSlider.addEventListener("change", async () => {
        await Storage.updateRecord(record.id, { interestLevel: Number(interestSlider.value) });
        renderList(await Storage.loadRecords());
      });

      interestWrap.appendChild(interestLabel);
      interestWrap.appendChild(interestSlider);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "history-item__delete";
      deleteBtn.textContent = "삭제";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await Storage.deleteRecord(record.id);
        render();
      });

      row.appendChild(badge);
      row.appendChild(body);
      row.appendChild(interestWrap);
      row.appendChild(deleteBtn);

      li.appendChild(row);
      li.appendChild(buildDetailPanel(record));

      // 클릭(터치)으로도 체크리스트/메모 펼치기 — 데스크톱은 hover로도 펼쳐짐
      li.addEventListener("click", () => {
        li.classList.toggle("is-expanded");
      });

      listEl.appendChild(li);
    });
  }

  async function render() {
    const records = await Storage.loadRecords();
    renderStats(records);
    renderList(records);
  }

  function wireUp() {
    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentFilter = btn.dataset.filter;
        document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        render();
      });
    });
  }

  return { render, wireUp };
})();

// ===== shareCard.js: 판결 카드를 이미지로 캡처/다운로드 (html2canvas 사용) =====
const ShareCard = (() => {
  function formatWon(amount) {
    return amount.toLocaleString("ko-KR") + "원";
  }

  function populateTemplate(record) {
    const badge = document.getElementById("shareVerdictBadge");
    badge.textContent = record.verdict;
    badge.style.background = record.verdict === "무죄" ? "rgba(0, 202, 142, 0.16)" : "rgba(255, 106, 95, 0.16)";
    badge.style.color = record.verdict === "무죄" ? "#00ca8e" : "#ff6a5f";

    document.getElementById("shareItemName").textContent = record.itemName;
    document.getElementById("sharePrice").textContent = formatWon(record.price);
    document.getElementById("shareVerdictReasoning").textContent = record.verdictReasoning;
    document.getElementById("sharePunchlineQuote").textContent = "“" + record.punchlineQuote + "”";
  }

  async function generateAndDownload(record) {
    if (typeof html2canvas === "undefined") {
      alert("이미지 생성 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.");
      return;
    }

    populateTemplate(record);
    const template = document.getElementById("shareCardTemplate");

    try {
      const canvas = await html2canvas(template, { scale: 2, backgroundColor: "#0a0b0d" });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `살까말까_${record.itemName}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch (e) {
      console.error(e);
      alert("이미지 생성에 실패했어요.");
    }
  }

  return { generateAndDownload };
})();

// ===== app.js 본체: 부트스트랩 - 모든 모듈 초기화 및 이벤트 연결 =====
document.addEventListener("DOMContentLoaded", () => {
  Router.wireUp();
  Settings.wireUp();
  HomeView.wireUp();
  TrialView.wireUp();
  ResultView.wireUp();
  HistoryView.wireUp();

  Router.showView("home");
});
