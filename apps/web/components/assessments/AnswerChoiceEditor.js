"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { GripVertical, X, Plus, ChevronDown, ChevronRight } from "lucide-react";

const LETTERS = "ABCDEFGHIJ";

export default function AnswerChoiceEditor({
  choices,
  onChange,
  allowMultipleCorrect,
  onAllowMultipleCorrectChange,
  showPartialCredit,
  onPartialCreditChange,
}) {
  const [expandedExplanations, setExpandedExplanations] = useState({});

  const toggleExplanation = (index) => {
    setExpandedExplanations((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const updateChoice = (index, field, value) => {
    const updated = choices.map((c, i) =>
      i === index ? { ...c, [field]: value } : c
    );
    onChange(updated);
  };

  const toggleCorrect = (index) => {
    let updated;
    if (allowMultipleCorrect) {
      updated = choices.map((c, i) =>
        i === index ? { ...c, isCorrect: !c.isCorrect } : c
      );
    } else {
      updated = choices.map((c, i) => ({
        ...c,
        isCorrect: i === index,
      }));
    }
    onChange(updated);
  };

  const addChoice = () => {
    if (choices.length >= 10) return;
    onChange([
      ...choices,
      { text: "", isCorrect: false, explanation: "" },
    ]);
  };

  const removeChoice = (index) => {
    const updated = choices.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            id="allow-multiple"
            checked={allowMultipleCorrect}
            onCheckedChange={(checked) => {
              // Reset correct answers when toggling
              const updated = choices.map((c) => ({ ...c, isCorrect: false }));
              onChange(updated);
              onAllowMultipleCorrectChange?.(checked);
            }}
          />
          <Label htmlFor="allow-multiple" className="text-sm">
            Allow multiple correct answers
          </Label>
        </div>
        {allowMultipleCorrect && (
          <div className="flex items-center gap-2">
            <Switch
              id="partial-credit"
              checked={showPartialCredit}
              onCheckedChange={onPartialCreditChange}
            />
            <Label htmlFor="partial-credit" className="text-sm">
              Partial credit
            </Label>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {choices.map((choice, index) => (
          <div
            key={index}
            className="flex flex-col rounded-lg border p-3 gap-2"
          >
            <div className="flex items-center gap-2">
              <div className="cursor-grab text-muted-foreground">
                <GripVertical className="h-4 w-4" />
              </div>

              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {LETTERS[index]}
              </span>

              <Input
                value={choice.text}
                onChange={(e) => updateChoice(index, "text", e.target.value)}
                placeholder={`Choice ${LETTERS[index]}`}
                className="flex-1"
              />

              <input
                type={allowMultipleCorrect ? "checkbox" : "radio"}
                name="correct-answer"
                checked={choice.isCorrect}
                onChange={() => toggleCorrect(index)}
                className="h-4 w-4 accent-primary"
                title="Mark as correct"
              />

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeChoice(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="pl-14">
              <button
                type="button"
                onClick={() => toggleExplanation(index)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {expandedExplanations[index] ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {expandedExplanations[index]
                  ? "Hide explanation"
                  : "Add explanation"}
              </button>

              {expandedExplanations[index] && (
                <textarea
                  value={choice.explanation || ""}
                  onChange={(e) =>
                    updateChoice(index, "explanation", e.target.value)
                  }
                  placeholder="Explain why this answer is correct/incorrect..."
                  rows={2}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={addChoice}
        disabled={choices.length >= 10}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add Choice
      </Button>
    </div>
  );
}
