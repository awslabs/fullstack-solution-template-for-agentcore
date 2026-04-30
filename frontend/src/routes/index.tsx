import { Routes, Route } from "react-router-dom"
import ChatPage from "./ChatPage"
import DashboardPage from "./DashboardPage"

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  )
}
