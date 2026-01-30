import { dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const eslintConfig = [
  // Ignore patterns
  {
    rules: {
      // Treat these as warnings instead of errors to prevent build failures
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
    },
    ignores: ["node_modules/**", "build/**", "delete/**", "tmp/**", ".vite/**", "src/app/**"],
  },
]

export default eslintConfig


