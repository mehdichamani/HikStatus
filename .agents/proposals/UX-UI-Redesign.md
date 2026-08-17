# UI/UX Redesign & Modernization Plan (HikStatus Web Interface)

## Context & Objective
HikStatus is an online camera status monitoring application for CCTV and security camera infrastructure. The web dashboard currently serves as the central hub for monitoring camera accessibility, latency, location mapping (Leaflet), and alert notifications. While functional, the visual aesthetic, visual hierarchy, color palette, typography scaling, and component modernism can be significantly enhanced.

The goal of this task is to execute a comprehensive UI/UX redesign of the HikStatus web interface without causing any regressions in existing functionality, DOM hooks, RTL support, backend API compatibility, or offline vendor assets (`Vazirmatn.woff2`, `leaflet.js`, `chart.umd.js`, etc.).

---

## 1. Design System & Palette Definition

### Color Palette (CSS Custom Properties)
We will standardize theme variables under `:root` (Light mode / default presets) and `[data-theme="dark"]` / theme-variant datasets (`navy`, `emerald`, `amber`, `amethyst`).

- **Dark Mode (Primary Theme)**:
  - `--bg-primary`: `#0b0f17` (Deep Obsidian / Charcoal)
  - `--bg-secondary`: `#111827` (Card Surface)
  - `--bg-tertiary`: `#1f293d` (Elevated Surface / Inputs)
  - `--border-color`: `rgba(255, 255, 255, 0.08)`
  - `--border-hover`: `rgba(255, 255, 255, 0.16)`
  - `--text-primary`: `#f9fafb`
  - `--text-secondary`: `#9ca3af`
  - `--text-muted`: `#6b7280`

- **Light Mode**:
  - `--bg-primary`: `#f8fafc` (Cool Light Grey)
  - `--bg-secondary`: `#ffffff` (Pure White Cards)
  - `--bg-tertiary`: `#f1f5f9` (Subtle Surface)
  - `--border-color`: `rgba(0, 0, 0, 0.08)`
  - `--border-hover`: `rgba(0, 0, 0, 0.16)`
  - `--text-primary`: `#0f172a`
  - `--text-secondary`: `#475569`
  - `--text-muted`: `#94a3b8`

- **Semantic & Status Indicators**:
  - **Online**: `--status-online: #10b981`, `--status-online-glow: rgba(16, 185, 129, 0.2)`
  - **Offline**: `--status-offline: #ef4444`, `--status-offline-glow: rgba(239, 68, 68, 0.2)`
  - **Minor Issue / Warning**: `--status-warning: #f59e0b`, `--status-warning-glow: rgba(245, 158, 11, 0.2)`
  - **Accent / Primary Action**: `--accent-primary: #6366f1` (Indigo/Purple), `--accent-hover: #4f46e5`

### Typography Scale & Hierarchy
- Local Vazirmatn font loaded via `@font-face` (`fonts/Vazirmatn.woff2`).
- Strict sizing & weight structure:
  - Page Title: `1.35rem`, font-weight `700`, line-height `1.3`
  - Section Header: `1.15rem`, font-weight `600`, line-height `1.4`
  - Metric Numbers: `1.75rem` / `2rem`, font-weight `700`, tabular numerals (`font-variant-numeric: tabular-nums`)
  - Body & Table Data: `0.9rem` / `0.95rem`, font-weight `400`, line-height `1.5`
  - Badges & Captions: `0.75rem` / `0.8rem`, font-weight `500`
- Enhanced RTL kerning and crisp text rendering (`-webkit-font-smoothing: antialiased`).

### Visual Affordances, Glassmorphism & Elevation
- Glassmorphism effects applied to Header, Floating Modals, Map Control Overlays, and Alert Banners using `backdrop-filter: blur(12px) saturate(180%)`.
- Layered shadow levels:
  - `var(--shadow-sm)`: `0 1px 3px rgba(0,0,0,0.12)`
  - `var(--shadow-md)`: `0 4px 14px rgba(0,0,0,0.18)`
  - `var(--shadow-lg)`: `0 10px 30px rgba(0,0,0,0.25)`
- Smooth transitions for interactive elements (`transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease`).

---

## 2. Component Breakdown

### Header & Navigation Bar
- Modernized layout with responsive flex alignment.
- Glowing status pill (`.pulse-dot`) indicating system state ("فعال" / active).
- Compact theme selector popover with clear light/dark & theme preset switches.
- Quick action buttons (Kiosk Mode, Export Data, Refresh) with micro-interaction hover effects.

### Overview Cards / Metric Widgets
- 4-card metric grid: Total Cameras (کل دوربین‌ها), Online (آنلاین), Offline (آفلاین), Availability Rate (درصد دسترس‌پذیری).
- Ambient background color glow corresponding to metric semantics (emerald glow for Online, crimson glow for Offline, indigo glow for Total, gold/emerald glow for Availability).
- Circular or bar progress indicators showing percentage breakdown.

### Live Status Table & Camera Grid
- Unified control filter bar (Search input with search icon, Status filter dropdown, Group filter dropdown, items per page selector).
- High-contrast, sticky table header with glassmorphism blur on scroll.
- Monospace IP address badges for quick readability (`font-family: monospace, Vazirmatn`).
- Latency indicators with dynamic color codes (<50ms green, 50-150ms amber, >150ms crimson).
- Status badges featuring live status dot (`.status-dot.online`, `.status-dot.offline`).
- Hover elevation and subtle background highlight on table rows.

### Interactive Leaflet Map Wrapper
- Map container (`#map`) styled with rounded border radius (`12px`) and subtle inset border.
- Custom styled Leaflet popups with theme-matching background and typography.
- Floating glass legend overlay (`.map-legend`) with color status keys.
- Fullscreen map mode button integrated cleanly.

### Alerting & Outage Banners
- Banner (`#outage-banner` / `#connection-warning`) positioned top-center with high-visibility warning iconography.
- Animated warning pulse indicator and dismiss action button.

### Modal Dialogs (Camera Details & About Us)
- Modern modal container with backdrop overlay (`backdrop-filter: blur(8px)`).
- Card layout inside modal displaying real-time latency line chart, status logs, ping statistics, and geolocation info.

---

## 3. Affected Files & Scope

1. **`static/index.html`**:
   - Modernize HTML layout structure while preserving all existing element IDs, attributes, and script dependencies.
   - Refine header flex structure, overview metric cards, control filter bar, table headers, and modal markup.

2. **`static/style.css`**:
   - Overhaul styles using CSS Custom Properties (`:root`, `[data-theme="dark"]`, etc.).
   - Implement glassmorphism, responsive grid layouts, card hover effects, custom scrollbars, and badge styling.

3. **`static/js/ui.js`**:
   - Update DOM helper functions (`updateOverviewStats`, `renderTable`, `showCameraModal`, `toggleThemeDropdown`, etc.) to support new status dot components, latency badge classes, and smooth animations while keeping backend API handling intact.

4. **`static/js/map.js`**:
   - Update Leaflet popup styling and marker icon configurations to match redesigned theme colors.

---

## 4. Verification & Regression Plan
- Verify all interactive UI functions (Search filter, Group filter, Status filter, Pagination, Kiosk toggle, Theme switcher).
- Verify map markers and popups render correctly on Leaflet.
- Verify Chart.js latency line chart updates dynamically in camera detail modal.
- Verify RTL alignment across mobile (<480px), tablet (<768px), and desktop screen resolutions.