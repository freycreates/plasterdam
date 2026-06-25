const FILTERS = [
  "Openbaar toilet",
  "Toilet in parkeergarage",
  "Seizoenstoilet",
  "Openbaar toilet, rolstoeltoegankelijk",
  "Seizoentoilet, rolstoeltoegankelijk",
  "Amsterdamse krul",
  "Verzinkbaar urinoir",
  "Overig urinoir",
  "Seizoensplaskruis",
];

const COLORS = {
  "Openbaar toilet": "#0f5c4f",
  "Toilet in parkeergarage": "#276d9b",
  "Seizoenstoilet": "#d89123",
  "Openbaar toilet, rolstoeltoegankelijk": "#1e8978",
  "Seizoentoilet, rolstoeltoegankelijk": "#f0aa3d",
  "Amsterdamse krul": "#c94b5f",
  "Verzinkbaar urinoir": "#7047a6",
  "Overig urinoir": "#6b7280",
  "Seizoensplaskruis": "#2f8e5f",
};

const AMSTERDAM_GEOJSON_URL = "https://maps.amsterdam.nl/open_geodata/geojson_lnglat.php?KAARTLAAG=OPENBARE_TOILETTEN&THEMA=openbare_toiletten";

const state = {
  activeFilters: new Set(FILTERS),
  allLocations: [],
  filtered: [],
  markers: [],
  userMarker: null,
};

const elements = {
  sheet: document.querySelector(".sheet"),
  sheetHeader: document.querySelector(".sheet-header"),
  filters: document.querySelector("#filters"),
  results: document.querySelector("#results"),
  searchInput: document.querySelector("#searchInput"),
  selectAllButton: document.querySelector("#selectAllButton"),
  clearButton: document.querySelector("#clearButton"),
  resultCount: document.querySelector("#resultCount"),
  resultLabel: document.querySelector("#resultLabel"),
  dataStatus: document.querySelector("#dataStatus"),
  locateButton: document.querySelector("#locateButton"),
  resultTemplate: document.querySelector("#resultTemplate"),
};

const hasLeaflet = typeof window.L !== "undefined";
const mapElement = document.querySelector("#map");
let map = null;

if (hasLeaflet) {
  map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
  }).setView([52.3676, 4.9041], 13);

  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
} else {
  mapElement.innerHTML = '<div class="map-fallback">Map unavailable. Filters and location list are still available.</div>';
}

function locationsFromGeoJson(data) {
  if (!data || !Array.isArray(data.features)) return [];

  return data.features.map((feature, index) => {
    const geometry = feature.geometry || {};
    const properties = feature.properties || {};
    const coordinates = geometry.coordinates || [];
    if (geometry.type !== "Point" || coordinates.length < 2) return null;

    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    const category = FILTERS.includes(properties.Soort) ? properties.Soort : "Openbaar toilet";
    const name = properties.Omschrijving || `${category} ${index + 1}`;
    const details = [
      properties.Openingstijden ? `Open: ${properties.Openingstijden}` : "",
      properties.Dagen_geopend ? `Days: ${properties.Dagen_geopend}` : "",
      Number.isFinite(Number(properties.Prijs_per_gebruik)) ? `Price: €${Number(properties.Prijs_per_gebruik).toFixed(2)}` : "",
    ].filter(Boolean).join(" · ");

    return {
      id: `${index}-${lat}-${lon}`,
      name,
      address: details,
      category,
      lat,
      lon,
      raw: properties,
    };
  }).filter((location) => (
    location
    && Number.isFinite(location.lat)
    && Number.isFinite(location.lon)
    && location.lat > 52
    && location.lat < 53
    && location.lon > 4
    && location.lon < 5.3
  ));
}

function markerIcon(category) {
  const color = COLORS[category] || COLORS["Openbaar toilet"];
  return L.divIcon({
    className: "toilet-marker",
    html: `<span style="background:${color};border:2px solid white;border-radius:999px;box-shadow:0 3px 10px rgba(0,0,0,.25);display:block;height:18px;width:18px"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
}

function routeUrl(location) {
  return `https://maps.apple.com/?daddr=${location.lat},${location.lon}&q=${encodeURIComponent(location.name)}`;
}

function popupHtml(location) {
  return `<div class="toilet-popup">
    <strong>${escapeHtml(location.name)}</strong>
    <span>${escapeHtml(location.category)}</span><br>
    ${location.address ? `<span>${escapeHtml(location.address)}</span><br>` : ""}
    <a href="${routeUrl(location)}" target="_blank" rel="noreferrer">Route</a>
  </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function renderFilters() {
  elements.filters.innerHTML = "";
  FILTERS.forEach((filter) => {
    const button = document.createElement("button");
    button.className = "filter-chip";
    button.type = "button";
    button.setAttribute("aria-pressed", state.activeFilters.has(filter));
    button.innerHTML = `<span class="swatch" style="background:${COLORS[filter]}"></span><span>${filter}</span>`;
    button.addEventListener("click", () => {
      if (state.activeFilters.has(filter)) state.activeFilters.delete(filter);
      else state.activeFilters.add(filter);
      renderFilters();
      applyFilters();
    });
    elements.filters.appendChild(button);
  });
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  state.filtered = state.allLocations.filter((location) => {
    const matchesFilter = state.activeFilters.has(location.category);
    const haystack = `${location.name} ${location.address} ${location.category}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
  renderMap();
  renderResults();
}

function renderMap() {
  if (!map) {
    elements.resultCount.textContent = state.filtered.length;
    elements.resultLabel.textContent = state.filtered.length === 1 ? "location" : "locations";
    return;
  }

  state.markers.forEach((marker) => marker.remove());
  state.markers = state.filtered.map((location) => {
    const marker = L.marker([location.lat, location.lon], { icon: markerIcon(location.category) })
      .addTo(map)
      .bindPopup(popupHtml(location));
    marker.locationId = location.id;
    return marker;
  });

  if (state.filtered.length) {
    const bounds = L.latLngBounds(state.filtered.map((location) => [location.lat, location.lon]));
    map.fitBounds(bounds.pad(0.16), { maxZoom: 15, animate: true });
  }

  elements.resultCount.textContent = state.filtered.length;
  elements.resultLabel.textContent = state.filtered.length === 1 ? "location" : "locations";
}

function renderResults() {
  elements.results.innerHTML = "";
  state.filtered.slice(0, 80).forEach((location) => {
    const node = elements.resultTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".result-type").textContent = location.category;
    node.querySelector(".result-name").textContent = location.name;
    node.querySelector(".result-address").textContent = location.address || `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`;
    node.querySelector(".route-link").href = routeUrl(location);
    node.querySelector(".result-main").addEventListener("click", () => {
      if (!map) return;
      const marker = state.markers.find((item) => item.locationId === location.id);
      map.setView([location.lat, location.lon], 17, { animate: true });
      if (marker) marker.openPopup();
    });
    elements.results.appendChild(node);
  });

  if (!state.filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No toilets match these filters.";
    elements.results.appendChild(empty);
  }
}

function locateUser() {
  if (!navigator.geolocation || !map) return;
  navigator.geolocation.getCurrentPosition((position) => {
    const latLng = [position.coords.latitude, position.coords.longitude];
    if (state.userMarker) state.userMarker.remove();
    state.userMarker = L.circleMarker(latLng, {
      radius: 8,
      color: "#0b3f38",
      fillColor: "#ffffff",
      fillOpacity: 1,
      weight: 3,
    }).addTo(map).bindPopup("You are here");
    map.setView(latLng, 16, { animate: true });
    state.userMarker.openPopup();
  }, () => {
    elements.dataStatus.textContent = "Location access was not available.";
  }, { enableHighAccuracy: true, timeout: 8000 });
}

elements.searchInput.addEventListener("input", applyFilters);
elements.selectAllButton.addEventListener("click", () => {
  state.activeFilters = new Set(FILTERS);
  renderFilters();
  applyFilters();
});
elements.clearButton.addEventListener("click", () => {
  state.activeFilters.clear();
  renderFilters();
  applyFilters();
});
elements.locateButton.addEventListener("click", locateUser);

const sheetDrag = {
  active: false,
  maxOffset: 0,
  offset: 0,
  startOffset: 0,
  startY: 0,
};

function sheetMaxOffset() {
  const height = elements.sheet.getBoundingClientRect().height;
  return Math.max(0, height - 76);
}

function setSheetOffset(offset) {
  sheetDrag.maxOffset = sheetMaxOffset();
  sheetDrag.offset = Math.min(Math.max(offset, 0), sheetDrag.maxOffset);
  elements.sheet.style.setProperty("--sheet-offset", `${sheetDrag.offset}px`);
}

function settleSheet() {
  const shouldLower = sheetDrag.offset > sheetDrag.maxOffset * 0.35;
  setSheetOffset(shouldLower ? sheetDrag.maxOffset : 0);
}

function installSheetDrag() {
  if (!elements.sheet || !elements.sheetHeader) return;

  const startDrag = (event, y) => {
    if (event.button !== undefined && event.button !== 0) return;
    sheetDrag.active = true;
    sheetDrag.startY = y;
    sheetDrag.startOffset = sheetDrag.offset;
    sheetDrag.maxOffset = sheetMaxOffset();
    elements.sheet.classList.add("is-dragging");
  };

  const moveDrag = (y) => {
    if (!sheetDrag.active) return;
    setSheetOffset(sheetDrag.startOffset + y - sheetDrag.startY);
  };

  const endDrag = () => {
    if (!sheetDrag.active) return;
    sheetDrag.active = false;
    elements.sheet.classList.remove("is-dragging");
    settleSheet();
  };

  elements.sheetHeader.addEventListener("mousedown", (event) => startDrag(event, event.clientY));
  window.addEventListener("mousemove", (event) => moveDrag(event.clientY));
  window.addEventListener("mouseup", endDrag);

  elements.sheetHeader.addEventListener("touchstart", (event) => {
    if (!event.touches.length) return;
    startDrag(event, event.touches[0].clientY);
  }, { passive: true });
  window.addEventListener("touchmove", (event) => {
    if (!event.touches.length) return;
    moveDrag(event.touches[0].clientY);
  }, { passive: true });
  window.addEventListener("touchend", endDrag);
  window.addEventListener("touchcancel", endDrag);
  window.addEventListener("resize", () => setSheetOffset(sheetDrag.offset));
}

async function boot() {
  installSheetDrag();
  renderFilters();

  try {
    const response = await fetch(AMSTERDAM_GEOJSON_URL, { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      const totalFeatures = Array.isArray(data.features) ? data.features.length : 0;
      const locations = locationsFromGeoJson(data);
      if (locations.length) {
        state.allLocations = locations;
        elements.dataStatus.textContent = `${locations.length} official Amsterdam locations mapped${totalFeatures > locations.length ? `; ${totalFeatures - locations.length} without coordinates` : ""}${map ? "" : "; map unavailable"}.`;
        applyFilters();
        return;
      }
    }
  } catch (error) {
    elements.dataStatus.textContent = "Official Amsterdam data could not be loaded.";
  }

  state.allLocations = [];
  applyFilters();
}

boot();
