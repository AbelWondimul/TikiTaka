"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, X } from "lucide-react";
import AnswerChoiceEditor from "@/components/assessments/AnswerChoiceEditor";
import CodingQuestionEditor from "@/components/assessments/CodingQuestionEditor";

const RichTextEditor = dynamic(
  () => import("@/components/assessments/RichTextEditor"),
  { ssr: false }
);

const TYPE_LABELS = {
  multiple_choice: "Multiple Choice",
  true_false: "True / False",
  short_answer: "Short Answer",
  essay: "Essay",
  coding: "Coding",
};

export default function QuestionEditor({ question, onSave, onCancel, isOpen }) {
  const [localQuestion, setLocalQuestion] = useState(null);

  useEffect(() => {
    if (question) {
      setLocalQuestion({ ...question });
    }
  }, [question]);

  if (!localQuestion) return null;

  const update = (field, value) => {
    setLocalQuestion((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(localQuestion);
  };

  // --- Type-specific renderers ---

  const renderMultipleChoice = () => (
    <AnswerChoiceEditor
      choices={localQuestion.choices || []}
      onChange={(choices) => update("choices", choices)}
      allowMultipleCorrect={localQuestion.allowMultipleCorrect || false}
      onAllowMultipleCorrectChange={(val) => update("allowMultipleCorrect", val)}
      showPartialCredit={localQuestion.partialCredit || false}
      onPartialCreditChange={(val) => update("partialCredit", val)}
    />
  );

  const renderTrueFalse = () => (
    <div className="space-y-2">
      <Label>Correct Answer</Label>
      <div className="flex gap-3">
        {["True", "False"].map((option) => (
          <label
            key={option}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 cursor-pointer hover:bg-muted"
          >
            <input
              type="radio"
              name="true-false-answer"
              checked={localQuestion.correctAnswer === option}
              onChange={() => update("correctAnswer", option)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-medium">{option}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const renderShortAnswer = () => (
    <div className="space-y-3">
      <div>
        <Label>Accepted Answers (one per line)</Label>
        <textarea
          value={(localQuestion.acceptedAnswers || []).join("\n")}
          onChange={(e) =>
            update(
              "acceptedAnswers",
              e.target.value.split("\n").filter((a) => a.trim())
            )
          }
          rows={4}
          placeholder="Enter each accepted answer on a new line..."
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="case-sensitive"
          checked={localQuestion.caseSensitive || false}
          onCheckedChange={(val) => update("caseSensitive", val)}
        />
        <Label htmlFor="case-sensitive" className="text-sm">
          Case sensitive
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="auto-grade"
          checked={localQuestion.autoGrade !== false}
          onCheckedChange={(val) => update("autoGrade", val)}
        />
        <Label htmlFor="auto-grade" className="text-sm">
          Auto-grade
        </Label>
      </div>
    </div>
  );

  const renderEssay = () => {
    const rubricCriteria = localQuestion.rubricCriteria || [];
    const totalPoints = rubricCriteria.reduce(
      (sum, c) => sum + (Number(c.maxPoints) || 0),
      0
    );

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Switch
            id="word-limit"
            checked={localQuestion.hasWordLimit || false}
            onCheckedChange={(val) => update("hasWordLimit", val)}
          />
          <Label htmlFor="word-limit" className="text-sm">
            Word limit
          </Label>
          {localQuestion.hasWordLimit && (
            <Input
              type="number"
              min={1}
              value={localQuestion.wordLimit || ""}
              onChange={(e) => update("wordLimit", Number(e.target.value))}
              placeholder="Max words"
              className="w-28 h-8"
            />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Rubric Criteria</Label>
            <span className="text-xs text-muted-foreground">
              Total: {totalPoints} pts
            </span>
          </div>
          {rubricCriteria.map((criterion, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={criterion.name}
                onChange={(e) => {
                  const updated = [...rubricCriteria];
                  updated[index] = { ...updated[index], name: e.target.value };
                  update("rubricCriteria", updated);
                }}
                placeholder="Criterion name"
                className="flex-1"
              />
              <Input
                type="number"
                min={0}
                value={criterion.maxPoints}
                onChange={(e) => {
                  const updated = [...rubricCriteria];
                  updated[index] = {
                    ...updated[index],
                    maxPoints: Number(e.target.value),
                  };
                  update("rubricCriteria", updated);
                }}
                placeholder="Pts"
                className="w-20"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  update(
                    "rubricCriteria",
                    rubricCriteria.filter((_, i) => i !== index)
                  );
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              update("rubricCriteria", [
                ...rubricCriteria,
                { name: "", maxPoints: 0 },
              ])
            }
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Criterion
          </Button>
        </div>
      </div>
    );
  };

  const renderCoding = () => (
    <CodingQuestionEditor
      language={localQuestion.language || "python"}
      onLanguageChange={(val) => update("language", val)}
      starterCode={localQuestion.starterCode || ""}
      onStarterCodeChange={(val) => update("starterCode", val)}
      testCases={localQuestion.testCases || []}
      onTestCasesChange={(val) => update("testCases", val)}
      showTestCases={localQuestion.showTestCases || false}
      onShowTestCasesChange={(val) => update("showTestCases", val)}
    />
  );

  const renderTypeSection = () => {
    switch (localQuestion.type) {
      case "multiple_choice":
        return renderMultipleChoice();
      case "true_false":
        return renderTrueFalse();
      case "short_answer":
        return renderShortAnswer();
      case "essay":
        return renderEssay();
      case "coding":
        return renderCoding();
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Question
            <Badge variant="secondary">
              {TYPE_LABELS[localQuestion.type] || localQuestion.type}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Question Content */}
          <div className="space-y-1.5">
            <Label>Question</Label>
            <RichTextEditor
              content={localQuestion.content || ""}
              onUpdate={(content) => update("content", content)}
              placeholder="Enter your question..."
              minHeight="120px"
            />
          </div>

          {/* Points & Required */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="points" className="text-sm">
                Points
              </Label>
              <Input
                id="points"
                type="number"
                min={0}
                value={localQuestion.points ?? 1}
                onChange={(e) => update("points", Number(e.target.value))}
                className="w-20 h-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="required"
                checked={localQuestion.required !== false}
                onCheckedChange={(val) => update("required", val)}
              />
              <Label htmlFor="required" className="text-sm">
                Required
              </Label>
            </div>
          </div>

          {/* Type-specific section */}
          <div className="border-t pt-4">{renderTypeSection()}</div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
