# Setup, GitHub Repository & Deployment Guide

This guide covers connecting your local repository to GitHub, triggering CI/CD, and deploying to Vercel.

---

## 1. Initializing Git & Pushing to GitHub

Run the following commands in the root `C:\image-upscaler` folder:

```powershell
cd C:\image-upscaler

# Initialize git repository
git init

# Stage all files (respecting .gitignore)
git add .

# Create initial commit
git commit -m "feat: complete initial image upscaler and print size calculator with CI/CD"

# Ensure default branch is main
git branch -M main

# Add your GitHub remote repository
git remote add origin https://github.com/sumedh22kar/Imag-Upscaler-BroDm.git

# Push code to GitHub
git push -u origin main
```

---

## 2. GitHub Actions CI/CD

Once pushed, GitHub Actions will trigger `.github/workflows/ci.yml`:
- **Backend Job**: Sets up Java 21 Temurin, caches Maven dependencies, and runs `./mvnw clean verify`.
- **Frontend Job**: Sets up Node.js 22, installs via `npm ci`, and builds production assets with Vite.

To protect your repository:
1. Go to your GitHub repository: `Settings` > `Branches`.
2. Add a branch protection rule for `main`.
3. Check **Require status checks to pass before merging** and select `Backend Build & Test (Java 21)` and `Frontend Build (Node.js & Vite)`.

---

## 3. Deploying Frontend to Vercel

1. Log into your [Vercel Dashboard](https://vercel.com) and click **Add New...** > **Project**.
2. Import the `Imag-Upscaler-BroDm` repository.
3. Configure the Project Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
4. Set Environment Variables:
   - Name: `VITE_API_BASE_URL`
   - Value: `https://your-deployed-backend-domain.com` (Your deployed Spring Boot backend URL)
5. Click **Deploy**.

`frontend/vercel.json` ensures that single-page application (SPA) routing works properly across reloads.
