"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Shield,
  Shuffle,
  Award,
  AlertTriangle,
  Calendar,
} from "lucide-react";

function Section({ title, icon: Icon, isOpen, onToggle, children }) {
  return (
    <div className="border-b">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 rounded-lg"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      {isOpen && <div className="px-3 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

export default function AssessmentSettings({ settings, onSettingsChange, classes }) {
  const [openSections, setOpenSections] = useState({
    basicInfo: true,
    availability: true,
    attempts: true,
    timer: true,
    randomization: true,
    browserLockdown: true,
    gradingRelease: true,
    lateSubmissions: true,
  });

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChange = (field, value) => {
    onSettingsChange({ [field]: value });
  };

  return (
    <div className="space-y-1 overflow-y-auto">
      {/* Section 1: Basic Info */}
      <Section
        title="Basic Info"
        icon={null}
        isOpen={openSections.basicInfo}
        onToggle={() => toggleSection("basicInfo")}
      >
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Class</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={settings.classId || ""}
            onChange={(e) => handleChange("classId", e.target.value)}
          >
            <option value="">Select a class</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            rows={3}
            value={settings.description || ""}
            onChange={(e) => handleChange("description", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Instructions</Label>
          <Textarea
            rows={4}
            value={settings.instructions || ""}
            onChange={(e) => handleChange("instructions", e.target.value)}
          />
        </div>
      </Section>

      {/* Section 2: Availability */}
      <Section
        title="Availability"
        icon={Calendar}
        isOpen={openSections.availability}
        onToggle={() => toggleSection("availability")}
      >
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(
                "flex-1 px-3 py-2 text-sm font-medium rounded-md border transition-colors",
                settings.status === "draft"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:bg-muted/50"
              )}
              onClick={() => handleChange("status", "draft")}
            >
              Draft
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 px-3 py-2 text-sm font-medium rounded-md border transition-colors",
                settings.status === "published"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:bg-muted/50"
              )}
              onClick={() => handleChange("status", "published")}
            >
              Published
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Always available</Label>
          <Switch
            checked={settings.alwaysAvailable || false}
            onCheckedChange={(val) => handleChange("alwaysAvailable", val)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Opens at</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              className="flex-1"
              value={settings.opensAtDate || ""}
              onChange={(e) => handleChange("opensAtDate", e.target.value)}
              disabled={settings.alwaysAvailable}
            />
            <Input
              type="time"
              className="flex-1"
              value={settings.opensAtTime || ""}
              onChange={(e) => handleChange("opensAtTime", e.target.value)}
              disabled={settings.alwaysAvailable}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Closes at</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              className="flex-1"
              value={settings.closesAtDate || ""}
              onChange={(e) => handleChange("closesAtDate", e.target.value)}
              disabled={settings.alwaysAvailable}
            />
            <Input
              type="time"
              className="flex-1"
              value={settings.closesAtTime || ""}
              onChange={(e) => handleChange("closesAtTime", e.target.value)}
              disabled={settings.alwaysAvailable}
            />
          </div>
        </div>
      </Section>

      {/* Section 3: Attempts */}
      <Section
        title="Attempts"
        icon={null}
        isOpen={openSections.attempts}
        onToggle={() => toggleSection("attempts")}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Allow multiple attempts</Label>
          <Switch
            checked={settings.allowMultipleAttempts || false}
            onCheckedChange={(val) => handleChange("allowMultipleAttempts", val)}
          />
        </div>
        {settings.allowMultipleAttempts && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Max attempts</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={settings.maxAttempts || 1}
              onChange={(e) => handleChange("maxAttempts", parseInt(e.target.value) || 1)}
            />
          </div>
        )}
      </Section>

      {/* Section 4: Timer */}
      <Section
        title="Timer"
        icon={Clock}
        isOpen={openSections.timer}
        onToggle={() => toggleSection("timer")}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Enable timer</Label>
          <Switch
            checked={settings.enableTimer || false}
            onCheckedChange={(val) => handleChange("enableTimer", val)}
          />
        </div>
        {settings.enableTimer && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Time limit</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={settings.timeLimitHours || 0}
                  onChange={(e) => handleChange("timeLimitHours", parseInt(e.target.value) || 0)}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">hrs</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={settings.timeLimitMinutes || 0}
                  onChange={(e) => handleChange("timeLimitMinutes", parseInt(e.target.value) || 0)}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Show timer to students</Label>
              <Switch
                checked={settings.showTimerToStudents || false}
                onCheckedChange={(val) => handleChange("showTimerToStudents", val)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Auto-submit when time expires</Label>
              <Switch
                checked={settings.autoSubmitOnExpiry || false}
                onCheckedChange={(val) => handleChange("autoSubmitOnExpiry", val)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Grace period (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={settings.gracePeriodMinutes || 0}
                onChange={(e) => handleChange("gracePeriodMinutes", parseInt(e.target.value) || 0)}
              />
            </div>
          </>
        )}
      </Section>

      {/* Section 5: Randomization */}
      <Section
        title="Randomization"
        icon={Shuffle}
        isOpen={openSections.randomization}
        onToggle={() => toggleSection("randomization")}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Randomize question order</Label>
          <Switch
            checked={settings.randomizeQuestionOrder || false}
            onCheckedChange={(val) => handleChange("randomizeQuestionOrder", val)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Randomize answer choices</Label>
          <Switch
            checked={settings.randomizeAnswerChoices || false}
            onCheckedChange={(val) => handleChange("randomizeAnswerChoices", val)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Pull random subset</Label>
          <Switch
            checked={settings.pullRandomSubset || false}
            onCheckedChange={(val) => handleChange("pullRandomSubset", val)}
          />
        </div>
        {settings.pullRandomSubset && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Show</Label>
            <Input
              type="number"
              min={1}
              value={settings.subsetQuestionCount || 1}
              onChange={(e) => handleChange("subsetQuestionCount", parseInt(e.target.value) || 1)}
              className="w-16"
            />
            <span className="text-xs text-muted-foreground">
              of {settings.totalQuestionCount || 0} questions
            </span>
          </div>
        )}
      </Section>

      {/* Section 6: Browser Lockdown */}
      <Section
        title="Browser Lockdown"
        icon={Shield}
        isOpen={openSections.browserLockdown}
        onToggle={() => toggleSection("browserLockdown")}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Enable lockdown</Label>
          <Switch
            checked={settings.enableLockdown || false}
            onCheckedChange={(val) => handleChange("enableLockdown", val)}
          />
        </div>
        {settings.enableLockdown && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Violations before auto-submit
              </Label>
              <Input
                type="number"
                min={1}
                value={settings.violationsBeforeAutoSubmit || 2}
                onChange={(e) =>
                  handleChange("violationsBeforeAutoSubmit", parseInt(e.target.value) || 2)
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Show violation count to student
              </Label>
              <Switch
                checked={settings.showViolationCount || false}
                onCheckedChange={(val) => handleChange("showViolationCount", val)}
              />
            </div>
          </>
        )}
      </Section>

      {/* Section 7: Grading & Release */}
      <Section
        title="Grading & Release"
        icon={Award}
        isOpen={openSections.gradingRelease}
        onToggle={() => toggleSection("gradingRelease")}
      >
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Release grades</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={settings.releaseGrades || "immediately"}
            onChange={(e) => handleChange("releaseGrades", e.target.value)}
          >
            <option value="immediately">Immediately on submit</option>
            <option value="manually">Manually</option>
            <option value="specific_date">On specific date</option>
          </select>
        </div>
        {settings.releaseGrades === "specific_date" && (
          <div className="flex gap-2">
            <Input
              type="date"
              className="flex-1"
              value={settings.releaseGradesDate || ""}
              onChange={(e) => handleChange("releaseGradesDate", e.target.value)}
            />
            <Input
              type="time"
              className="flex-1"
              value={settings.releaseGradesTime || ""}
              onChange={(e) => handleChange("releaseGradesTime", e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Show correct answers</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={settings.showCorrectAnswers || "never"}
            onChange={(e) => handleChange("showCorrectAnswers", e.target.value)}
          >
            <option value="never">Never</option>
            <option value="immediately">Immediately</option>
            <option value="after_grades_released">After grades released</option>
            <option value="specific_date">On specific date</option>
          </select>
        </div>
        {settings.showCorrectAnswers === "specific_date" && (
          <div className="flex gap-2">
            <Input
              type="date"
              className="flex-1"
              value={settings.showCorrectAnswersDate || ""}
              onChange={(e) => handleChange("showCorrectAnswersDate", e.target.value)}
            />
            <Input
              type="time"
              className="flex-1"
              value={settings.showCorrectAnswersTime || ""}
              onChange={(e) => handleChange("showCorrectAnswersTime", e.target.value)}
            />
          </div>
        )}
      </Section>

      {/* Section 8: Late Submissions */}
      <Section
        title="Late Submissions"
        icon={AlertTriangle}
        isOpen={openSections.lateSubmissions}
        onToggle={() => toggleSection("lateSubmissions")}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Allow late submissions</Label>
          <Switch
            checked={settings.allowLateSubmissions || false}
            onCheckedChange={(val) => handleChange("allowLateSubmissions", val)}
          />
        </div>
        {settings.allowLateSubmissions && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Penalty (% per day late)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={settings.latePenaltyPercent || 0}
                onChange={(e) =>
                  handleChange("latePenaltyPercent", parseInt(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Accept until</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  className="flex-1"
                  value={settings.acceptUntilDate || ""}
                  onChange={(e) => handleChange("acceptUntilDate", e.target.value)}
                />
                <Input
                  type="time"
                  className="flex-1"
                  value={settings.acceptUntilTime || ""}
                  onChange={(e) => handleChange("acceptUntilTime", e.target.value)}
                />
              </div>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
