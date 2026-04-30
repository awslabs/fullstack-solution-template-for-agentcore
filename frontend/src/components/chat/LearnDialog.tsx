"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "data_model", label: "Data Model" },
  { value: "writing", label: "Writing" },
  { value: "operations", label: "Operations" },
  { value: "bug", label: "Bug" },
]

interface LearnDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (lesson: string, category: string) => Promise<void>
}

export function LearnDialog({ open, onClose, onSubmit }: LearnDialogProps) {
  const [lesson, setLesson] = useState("")
  const [category, setCategory] = useState("general")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    if (!lesson.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(lesson.trim(), category)
      setSuccess(true)
      setTimeout(() => { setLesson(""); setCategory("general"); setSuccess(false); onClose() }, 1200)
    } catch { /* ignore */ }
    finally { setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">📝 Teach the Agent</DialogTitle>
        </DialogHeader>
        {success ? (
          <div className="text-center py-6">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-sm text-gray-600">Lesson logged!</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea value={lesson} onChange={e => setLesson(e.target.value)} placeholder="e.g. Always check imageUrl before updating exhibits…"
              rows={3} className="text-sm" autoFocus />
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setCategory(c.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${category === c.value ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <Button onClick={handleSubmit} disabled={!lesson.trim() || submitting} className="w-full" size="sm">
              {submitting ? "Saving…" : "Save Lesson"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
