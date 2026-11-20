const RATE_LIMIT_INTERVAL = 1100;

const fields = {
  origin: createField("origin"),
  destination: createField("destination"),
};

const calculateButton = document.querySelector("#calculate");
const resultCard = document.querySelector("#result");
const distanceValue = document.querySelector("#distance-value");
const mapLink = document.querySelector("#map-link");
let lastRequestStartedAt = 0;
let requestQueue = Promise.resolve();

function createField(name) {
  const input = document.querySelector(`#${name}`);
  const suggestions = document.querySelector(`#${name}-suggestions`);
  const message = document.querySelector(`#${name}-message`);
  const searchButton = input.parentElement.querySelector(".search-button");

  return {
    input,
    suggestions,
    message,
    searchButton,
    selected: null,
    controller: null,
    results: [],
  };
}

function setMessage(field, text, isError = false) {
  field.message.textContent = text;
  field.message.classList.toggle("is-error", isError);
}

function closeSuggestions(field) {
  field.suggestions.hidden = true;
  field.input.setAttribute("aria-expanded", "false");
}

function updateCalculateButton() {
  calculateButton.disabled = !fields.origin.selected || !fields.destination.selected;
}

function clearSearch(field) {
  field.controller?.abort();
  field.controller = null;
  field.searchButton.disabled = false;
  field.results = [];
  closeSuggestions(field);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Search canceled", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);

    function cancel() {
      clearTimeout(timer);
      reject(new DOMException("Search canceled", "AbortError"));
    }

    signal.addEventListener("abort", cancel, { once: true });
  });
}

function searchLocations(query, signal) {
  const search = requestQueue.then(async () => {
    const delay = Math.max(
      0,
      RATE_LIMIT_INTERVAL - (Date.now() - lastRequestStartedAt),
    );
    if (delay > 0) await wait(delay, signal);
    if (signal.aborted) throw new DOMException("Search canceled", "AbortError");

    lastRequestStartedAt = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      limit: "5",
      "accept-language": "ko",
    });

    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("장소를 검색하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return response.json();
  });

  requestQueue = search.catch(() => {});
  return search;
}

function renderSuggestions(field, places) {
  field.suggestions.replaceChildren();
  field.results = places;

  if (places.length === 0) {
    setMessage(field, "검색 결과가 없어요. 다른 이름으로 검색해 보세요.", true);
    closeSuggestions(field);
    return;
  }

  for (const [index, place] of places.entries()) {
    const item = document.createElement("li");
    item.className = "suggestion-option";
    item.id = `${field.input.id}-option-${index}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.tabIndex = 0;

    const parts = place.display_name.split(",").map((part) => part.trim());
    const title = document.createElement("strong");
    title.textContent = parts.slice(0, 2).join(", ");
    const detail = document.createElement("span");
    detail.textContent = parts.slice(2).join(", ");
    item.append(title, detail);

    item.addEventListener("click", () => selectPlace(field, place));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPlace(field, place);
      } else if (event.key === "Escape") {
        closeSuggestions(field);
        field.input.focus();
      }
    });
    field.suggestions.append(item);
  }

  field.suggestions.hidden = false;
  field.input.setAttribute("aria-expanded", "true");
  setMessage(field, "목록에서 실제 장소를 선택해 주세요.");
}

function selectPlace(field, place) {
  clearSearch(field);
  field.selected = {
    name: place.display_name,
    lat: Number(place.lat),
    lon: Number(place.lon),
  };
  field.input.value = place.display_name;
  field.input.setAttribute("aria-expanded", "false");
  setMessage(field, "장소를 선택했어요.");
  resultCard.hidden = true;
  updateCalculateButton();
}

async function searchField(field) {
  clearSearch(field);
  const query = field.input.value.trim();
  if (query.length < 2) {
    setMessage(field, "두 글자 이상 입력해 주세요.", true);
    return;
  }

  const controller = new AbortController();
  field.controller = controller;
  field.searchButton.disabled = true;
  setMessage(field, "장소를 찾고 있어요...");

  try {
    const places = await searchLocations(query, controller.signal);
    if (field.input.value.trim() !== query) return;
    renderSuggestions(field, places);
  } catch (error) {
    if (error.name === "AbortError") return;
    setMessage(field, error.message || "검색 중 문제가 생겼어요. 다시 시도해 주세요.", true);
    closeSuggestions(field);
  } finally {
    if (field.controller === controller) {
      field.controller = null;
      field.searchButton.disabled = false;
    }
  }
}

for (const field of Object.values(fields)) {
  field.searchButton.addEventListener("click", () => searchField(field));
  field.input.addEventListener("input", () => {
    clearSearch(field);
    field.selected = null;
    resultCard.hidden = true;
    updateCalculateButton();
    setMessage(field, field.input.value.trim() ? "검색 버튼을 눌러 장소를 확인해 주세요." : "");
  });
  field.input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSuggestions(field);
    if (event.key === "Enter") {
      event.preventDefault();
      searchField(field);
    }
    if (event.key === "ArrowDown" && !field.suggestions.hidden) {
      event.preventDefault();
      field.suggestions.querySelector('[role="option"]')?.focus();
    }
  });
  field.input.addEventListener("blur", (event) => {
    if (event.relatedTarget && field.input.parentElement.contains(event.relatedTarget)) return;
    window.setTimeout(() => closeSuggestions(field), 120);
  });
}

function getDistanceInMeters(start, end) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(end.lat - start.lat);
  const longitudeDelta = radians(end.lon - start.lon);
  const startLatitude = radians(start.lat);
  const endLatitude = radians(end.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatDistance(meters) {
  if (meters < 1000) {
    const roundedMeters = Math.round(meters / 10) * 10;
    return `${new Intl.NumberFormat("ko-KR").format(roundedMeters)} m`;
  }

  const kilometers = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(meters / 1000);
  return `${kilometers} km`;
}

calculateButton.addEventListener("click", () => {
  const start = fields.origin.selected;
  const end = fields.destination.selected;
  if (!start || !end) return;

  distanceValue.textContent = formatDistance(getDistanceInMeters(start, end));
  document.querySelector("#origin-summary").textContent = start.name;
  document.querySelector("#destination-summary").textContent = end.name;

  const route = `${start.lat},${start.lon};${end.lat},${end.lon}`;
  mapLink.href = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`;
  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
