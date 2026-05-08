"use client";

import { Check } from "lucide-react";

export type WizardStep = 1 | 2 | 3 | 4;

const STEPS: { num: WizardStep; label: string }[] = [
  { num: 1, label: "Beskrivning" },
  { num: 2, label: "Material & arbete" },
  { num: 3, label: "Pris & butik" },
  { num: 4, label: "Sammanställning" },
];

export default function Stepper({
  current,
  furthest,
  onJump,
}: {
  current: WizardStep;
  furthest: WizardStep;
  onJump: (step: WizardStep) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 py-4 px-3 bg-white border-b border-gray-200">
      {STEPS.map((s, i) => {
        const reached = s.num <= furthest;
        const active = s.num === current;
        const done = s.num < current;
        return (
          <div key={s.num} className="flex items-center">
            <button
              onClick={() => reached && onJump(s.num)}
              disabled={!reached}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-green-700 text-white shadow-sm"
                  : reached
                  ? "text-gray-700 hover:bg-gray-100 cursor-pointer"
                  : "text-gray-300 cursor-not-allowed"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  active
                    ? "bg-white text-green-700"
                    : done
                    ? "bg-green-700 text-white"
                    : reached
                    ? "bg-gray-200 text-gray-700"
                    : "bg-gray-100 text-gray-300"
                }`}
              >
                {done ? <Check size={13} /> : s.num}
              </span>
              <span className="font-semibold hidden sm:inline">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`w-4 sm:w-8 h-0.5 mx-0.5 ${
                  s.num < current ? "bg-green-700" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
