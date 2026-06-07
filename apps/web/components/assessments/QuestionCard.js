import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { GripVertical, Pencil, Copy, Trash2 } from 'lucide-react'

const typeConfig = {
  multiple_choice: { label: 'Multiple Choice', color: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  true_false: { label: 'True / False', color: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' },
  short_answer: { label: 'Short Answer', color: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800' },
  essay: { label: 'Essay', color: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800' },
  coding: { label: 'Coding', color: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
}

function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '')
}

function truncate(text, maxLength = 80) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

export default function QuestionCard({ question, index, onEdit, onDuplicate, onDelete, dragHandleProps }) {
  const config = typeConfig[question.type] || typeConfig.multiple_choice
  const displayText = truncate(stripHtml(question.content || question.text || ''))

  return (
    <div className="p-3 border rounded-lg bg-card hover:bg-muted/30 transition-colors flex items-center gap-3">
      <div className="cursor-grab text-muted-foreground" {...dragHandleProps}>
        <GripVertical className="h-5 w-5" />
      </div>

      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium shrink-0">
        {index + 1}
      </div>

      <Badge className={`shrink-0 ${config.color}`}>
        {config.label}
      </Badge>

      <span className="text-sm text-muted-foreground truncate flex-1 min-w-0">
        {displayText || 'Untitled question'}
      </span>

      <Badge variant="secondary" className="shrink-0">
        {question.points || 0} pts
      </Badge>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit?.(question, index)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDuplicate?.(question, index)}>
          <Copy className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete?.(question, index)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
