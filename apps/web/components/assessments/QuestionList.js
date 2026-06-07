import { useState } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { ListChecks, ToggleLeft, Type, FileText, Code, Plus } from 'lucide-react'
import QuestionCard from './QuestionCard'

const questionTypes = [
  { type: 'multiple_choice', label: 'Multiple Choice', icon: ListChecks, description: 'Students pick one or more correct answers' },
  { type: 'true_false', label: 'True / False', icon: ToggleLeft, description: 'Simple true or false statement' },
  { type: 'short_answer', label: 'Short Answer', icon: Type, description: 'Brief text response expected' },
  { type: 'essay', label: 'Essay', icon: FileText, description: 'Long-form written response' },
  { type: 'coding', label: 'Coding', icon: Code, description: 'Code solution with optional test cases' },
]

function SortableQuestionItem({ question, index, onEdit, onDuplicate, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: question.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <QuestionCard
        question={question}
        index={index}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        dragHandleProps={listeners}
      />
    </div>
  )
}

export default function QuestionList({ questions, onReorder, onEditQuestion, onDuplicateQuestion, onDeleteQuestion, onAddQuestion }) {
  const [showTypePicker, setShowTypePicker] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = questions.findIndex((q) => q.id === active.id)
    const newIndex = questions.findIndex((q) => q.id === over.id)
    const newOrder = arrayMove(questions, oldIndex, newIndex)
    onReorder?.(newOrder)
  }

  function handleSelectType(type) {
    setShowTypePicker(false)
    onAddQuestion?.(type)
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          {questions.map((question, index) => (
            <SortableQuestionItem
              key={question.id}
              question={question}
              index={index}
              onEdit={onEditQuestion}
              onDuplicate={onDuplicateQuestion}
              onDelete={onDeleteQuestion}
            />
          ))}
        </SortableContext>
      </DndContext>

      {questions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
          No questions yet. Add your first question below.
        </div>
      )}

      <div className="pt-2">
        <Button variant="outline" className="w-full" onClick={() => setShowTypePicker(!showTypePicker)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Question
        </Button>
      </div>

      {showTypePicker && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 border rounded-lg bg-card">
          {questionTypes.map(({ type, label, icon: Icon, description }) => (
            <button
              key={type}
              onClick={() => handleSelectType(type)}
              className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-center cursor-pointer"
            >
              <Icon className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
