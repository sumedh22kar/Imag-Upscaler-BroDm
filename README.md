# Imag-Upscaler-BroDm (PixelPerfect Image Upscaler)

A full-stack, deterministic image upscaler and print size calculator built with **Spring Boot 3.5 (Java 21)** and **React 19 (Vite)**. Focuses on natural, conservative image resampling without artificial AI filtering or distortion.

---

## 🌟 Key Features

- **Conservative Resampling**: Uses high-quality bicubic interpolation with optional micro-sharpening for clean, natural upscaling.
- **Print Size Calculator**:
  - Presets: A3, A4, A5, US Letter, US Legal, and Custom (cm or inches).
  - Orientation toggle: Portrait (↕) & Landscape (↔).
  - Configurable DPI: 72, 96, 150, 300 (Standard Print), and 600 DPI.
  - Automatic pixel dimension computation via dedicated REST API (`/api/images/print-sizes`).
- **Comprehensive Format Support**:
  - Supports **PNG**, **JPEG**, **WebP**, **BMP**, and **TIFF** encoding & decoding (powered by TwelveMonkeys ImageIO and Sejda WebP).
  - Dynamic format synchronization from backend `/api/images/config`.
  - Lossless alpha transparency preservation.
- **Embedded DPI Metadata**: Embeds print resolution into exported image metadata (`pHYs` chunks for PNG, `app0JFIF` density for JPEG).
- **Safety Boundary Enforcement**: Strict $8192 \times 8192$ px resolution caps to prevent server resource exhaustion, with proactive client-side limit detection.
- **Responsive Web UI**: Built with React 19 and custom Vanilla CSS design tokens.

---

## 🛠️ Architecture & Tech Stack

### Backend
- **Language & Runtime**: Java 21
- **Framework**: Spring Boot 3.5.x
- **Build Tool**: Maven (`mvnw`)
- **Image Processing**: Java `ImageIO`, `TwelveMonkeys ImageIO (TIFF)`, `Sejda WebP`
- **Testing**: JUnit 5, Spring Boot Test, MockMvc (40 unit/integration tests)

### Frontend
- **Framework**: React 19
- **Build Tool**: Vite 8
- **Styling**: Vanilla CSS (zero utility framework bloat)
- **Deployment**: Vercel ready (`vercel.json` SPA rewrite)

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :---: | :--- | :--- |
| `POST` | `/api/images/upscale` | Upload and process image, returns JSON metadata & base64 preview URL. |
| `POST` | `/api/images/download` | Upload and process image, returns direct binary file download. |
| `GET` | `/api/images/print-sizes` | Calculate pixel dimensions based on preset or custom cm/inches at specific DPI. |
| `GET` | `/api/images/config` | Retrieve server capability limits, supported models, and available formats. |
| `POST` | `/api/images/validate-settings` | Pre-flight validation of dimension and compression constraints. |
| `GET` | `/actuator/health` | Spring Boot Actuator application health indicator. |

---

## 🚀 Local Development

### Prerequisites
- Java 21 JDK
- Node.js 20+ (Node.js 22+ recommended)

### 1. Start the Backend
```bash
cd backend
./mvnw clean spring-boot:run
```
Backend will start on `http://localhost:8808`.

### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend will be available at `http://localhost:5173`.

---

## 🧪 Testing

Run backend test suite:
```bash
cd backend
./mvnw clean test
```

Run frontend build verification:
```bash
cd frontend
npm run build
```

---

## 🚢 CI/CD & Deployment

- **GitHub Actions**: Automated CI workflow (`.github/workflows/ci.yml`) runs on push and PRs to `main`, validating Java 21 compilation, unit tests, and Node.js production bundle build.
- **Vercel**: Deploy the `frontend/` directory with `VITE_API_BASE_URL` pointing to the public backend endpoint.
