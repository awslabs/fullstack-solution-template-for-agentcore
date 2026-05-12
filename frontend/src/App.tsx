// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { BrowserRouter } from "react-router-dom"
import { AuthProvider } from "@/components/auth/AuthProvider"
import AppRoutes from "./routes"
import { useToolRenderer } from "@/hooks/useToolRenderer"
import { BrowserToolDisplay } from "@/components/chat/BrowserToolDisplay"

// Register browser tool renderer (runs once at module load).
// Must wrap in JSX so hooks run inside the component, not inside the caller.
useToolRenderer("browser", props => <BrowserToolDisplay {...props} />)

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
