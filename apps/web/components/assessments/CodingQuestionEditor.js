"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const LANGUAGES = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "sql", label: "SQL" },
  { value: "html", label: "HTML/CSS" },
];

export default function CodingQuestionEditor({
  language,
  onLanguageChange,
  starterCode,
  onStarterCodeChange,
  testCases,
  onTestCasesChange,
  showTestCases,
  onShowTestCasesChange,
}) {
  const addTestCase = () => {
    onTestCasesChange([
      ...testCases,
      { input: "", expectedOutput: "", hidden: false },
    ]);
  };

  const removeTestCase = (index) => {
    onTestCasesChange(testCases.filter((_, i) => i !== index));
  };

  const updateTestCase = (index, field, value) => {
    const updated = testCases.map((tc, i) =>
      i === index ? { ...tc, [field]: value } : tc
    );
    onTestCasesChange(updated);
  };

  return (
    <div className="space-y-4">
      {/* Language Selector */}
      <div className="space-y-1.5">
        <Label>Language</Label>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>

      {/* Starter Code */}
      <div className="space-y-1.5">
        <Label>Starter Code (shown to students)</Label>
        <div className="rounded-md overflow-hidden border">
          <MonacoEditor
            height="150px"
            language={language === "cpp" ? "cpp" : language}
            theme="vs-dark"
            value={starterCode}
            onChange={(value) => onStarterCodeChange(value || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              tabSize: 2,
            }}
          />
        </div>
      </div>

      {/* Test Cases */}
      <div className="space-y-2">
        <Label>Test Cases</Label>
        {testCases.map((tc, index) => (
          <div key={index} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Test Case {index + 1}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Switch
                    id={`hidden-${index}`}
                    checked={tc.hidden}
                    onCheckedChange={(checked) =>
                      updateTestCase(index, "hidden", checked)
                    }
                  />
                  <Label htmlFor={`hidden-${index}`} className="text-xs">
                    Hidden
                  </Label>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeTestCase(index)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Input</Label>
                <textarea
                  value={tc.input}
                  onChange={(e) =>
                    updateTestCase(index, "input", e.target.value)
                  }
                  rows={2}
                  placeholder="stdin input..."
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <Label className="text-xs">Expected Output</Label>
                <textarea
                  value={tc.expectedOutput}
                  onChange={(e) =>
                    updateTestCase(index, "expectedOutput", e.target.value)
                  }
                  rows={2}
                  placeholder="expected stdout..."
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addTestCase} className="w-full">
          <Plus className="h-4 w-4 mr-1" />
          Add Test Case
        </Button>
      </div>

      {/* Show test cases toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="show-test-cases"
          checked={showTestCases}
          onCheckedChange={onShowTestCasesChange}
        />
        <Label htmlFor="show-test-cases" className="text-sm">
          Show test cases to students
        </Label>
      </div>

      {/* Note */}
      <p className="text-xs text-muted-foreground italic">
        Code execution requires backend worker setup — runs client-side preview
        only.
      </p>
    </div>
  );
}
