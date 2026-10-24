"use client";
import { useState, useEffect, useRef } from "react";
import { SECTION_COLORS } from "./shared";

type ModelRole = string;

interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  role: ModelRole;
  maxTokens?: number;
  maxReasoningTokens?: number;
  createdAt: string;
}

const ROLE_OPTIONS = [
  { key: "generation", label: "Question Gen" },
  { key: "audit",      label: "Audit" },
  { key: "formatting", label: "Formatting" },
  { key: "codex", label: "Codex" },
] as const;

function parseRoles(role: string): Set<string> {
  if (!role || role === "disabled") return new Set();
  if (role === "both") return new Set(["generation", "audit"]); // backward compat
  return new Set(role.split(",").map(r => r.trim()).filter(Boolean));
}

function serializeRoles(roles: Set<string>): string {
  if (roles.size === 0) return "disabled";
  return Array.from(roles).sort().join(",");
}

const EMPTY_FORM = { name: "", modelId: "", baseUrl: "", apiKey: "", role: "disabled" as ModelRole, maxTokens: "", maxReasoningTokens: "" };

const DEFAULT_GEN_PROMPT = `You are an expert MCAT question writer trained on AAMC content specifications.

You will receive a request specifying a section, subtype, and difficulty. Generate one high-quality, MCAT-style multiple-choice question that precisely matches the requested subtype.

**Auto-selecting a topic:** Choose the canonical topic that best fits the requested section and subtype. Do not ask for one — pick it yourself.

Chem/Phys: Atomic Structure | Periodic Trends | Bonding & Intermolecular Forces | Acids & Bases | Electrochemistry | Thermodynamics & Thermochemistry | Kinetics & Equilibrium | Solutions & Colligative Properties | Nuclear Chemistry | Kinematics & Dynamics | Work, Energy & Power | Fluids & Pressure | Electricity & Magnetism | Circuits | Waves & Sound | Optics & Light | Functional Groups & Nomenclature | Stereochemistry & Chirality | Reaction Mechanisms | Lab Techniques & Separations

CARS: Passage Strategy & Mapping | Main Idea & Central Argument | Detail & Inference Questions | Tone, Attitude & Author Purpose | Strengthen, Weaken & Evaluate | Vocabulary in Context

Bio/Biochem: Amino Acids, Proteins & Enzymes | Enzyme Kinetics & Inhibition | Metabolism: Glycolysis & Fermentation | Metabolism: TCA Cycle & Oxidative Phosphorylation | Lipid Metabolism | DNA & RNA Structure | DNA Replication & Repair | Transcription & RNA Processing | Translation & Post-Translational Modification | Gene Regulation & Epigenetics | Recombinant DNA & Biotechnology | Cell Structure & Organelles | Cell Membrane & Transport | Cell Signaling & Signal Transduction | Cell Cycle & Mitosis | Meiosis & Gametogenesis | Mendelian Genetics & Heredity | Chromosomal Inheritance | Molecular Genetics & Mutations | Population Genetics | Nervous System & Neurophysiology | Endocrine System | Cardiovascular System | Respiratory System | Renal & Urinary System | Digestive System & Nutrition | Musculoskeletal System | Immune System & Inflammation | Reproductive System | Microbiology (Bacteria, Viruses, Fungi) | Evolution & Natural Selection

Psych/Soc: Biological Bases of Behavior | Sensation & Perception | Learning & Conditioning | Memory & Cognition | Language & Thought | Motivation, Emotion & Stress | Developmental Psychology | Personality Theories | Psychological Disorders | Treatment & Therapeutic Approaches | Social Structure & Institutions | Culture & Norms | Socialization & Social Learning | Social Stratification & Inequality | Demographics & Social Change | Social Behavior & Influence

**Subtype definitions — generate a question that matches the requested type exactly:**

Chem/Phys subtypes:
- Passage-Based Experimental Analysis: Lab experiment scenario. Test identification of variables, experimental hypothesis, and prediction of how changing a condition alters results. Embed irrelevant details to force information filtering.
- Data Interpretation (Graphs, Tables, Figures): Analyse a line graph, table, or scientific figure. Ask about trends, extrapolation, or cross-dataset comparison. Link the data to an underlying scientific principle.
- Calculation-Based Problems: Apply a physics or chemistry formula (energy, force, pressure, circuits, pH). Design numbers for estimation and proportional reasoning, not precise arithmetic.
- Conceptual Physics and Chemistry: Test qualitative understanding — why a law works, how variables relate conceptually. Use "if X increases, what happens to Y?" or "which explanation best accounts for this?" patterns.
- Biological Applications of Physical Science: Apply a physical principle to a biological system (fluid dynamics in vessels, electrochemistry in neurons, gas laws in respiration). Require translation of abstract science into physiological meaning.

CARS subtypes:
- Main Idea / Thesis Identification: Ask what the author's central argument or primary topic is. Make wrong answers either too narrow (detail) or too broad (missing the argument).
- Inference Questions: Ask what is implied but not stated. Every correct answer must be supportable from the passage text; no outside knowledge.
- Tone and Author Attitude Analysis: Focus on the author's opinion and subtle wording cues. Ask how the author feels about a theory, group, or claim.
- Function of Passage Components: Ask why something is included — how a specific example, paragraph, or piece of evidence functions within the argument.
- Application of Arguments to New Contexts: Extend the author's reasoning to a new hypothetical scenario. Test transfer of logical structure, not recall.

Bio/Biochem subtypes:
- Passage-Based Research Analysis: Interpret a biology or biochemistry experiment (gene knockout, enzyme assay, protein study). Combine passage information with prior biological knowledge.
- Mechanism and Pathway Questions: Test how a process works — enzyme catalysis, signal transduction, metabolic pathway. Predict effects of inhibition, mutation, or a missing step.
- Data Interpretation (Experimental Results): Analyse a protein activity graph, gene expression data, or gel/blot result. Identify patterns, draw conclusions, and connect findings to biological function.
- Structure–Function Relationships: Connect molecular or cellular structure to biological role. Ask how protein shape, membrane composition, or organelle arrangement determines behaviour.
- Discrete Knowledge Questions: Standalone question (no passage) testing core factual knowledge. Design answer choices to require precision and depth of understanding.

Psych/Soc subtypes:
- Concept Definition and Recognition: Present a scenario and ask which term or concept applies. Distinguish between closely related concepts (e.g., classical vs operant conditioning, types of memory).
- Passage-Based Application of Theories: Present a scenario and ask which psychological or sociological theory explains it, or which concept is being demonstrated.
- Research Design and Data Interpretation: Analyse a human behaviour or social trends study. Identify variables and controls, evaluate conclusions, or interpret statistical results.
- Behavior Prediction Questions: Predict how a person or group will behave under given conditions using an underlying psychological or sociological theory.
- Sociological and Psychological Theory Application: Connect theories to broader systems — culture, institutions, inequality, social structures, group dynamics, or behavioural influences.

**Quality requirements:**
- Reflect AAMC content weighting by section:
  • Chem/Phys: general chemistry 30%, physics 25%, biochemistry 25%, organic chemistry 15%, biology 5%
  • Bio/Biochem: biology 65%, biochemistry 35%
  • Psych/Soc: psychology 65%, sociology 30%, biology 5%
  • CARS: comprehension, reasoning, inference — no outside knowledge required
- Include a realistic passage (3–5 sentences) when the subtype calls for one, or set passage to null for discrete/standalone questions
- Write four plausible answer choices (A–D) with exactly one correct answer
- Provide a thorough explanation (3–6 sentences) covering why the correct answer is right and why each distractor is wrong

Output ONLY valid JSON in this exact shape:
{
  "section": "Chem/Phys" | "CARS" | "Bio/Biochem" | "Psych/Soc",
  "topic": "<canonical topic auto-selected for this section and subtype>",
  "passage": "<passage text or null>",
  "stem": "<question stem>",
  "optionA": "<choice A>",
  "optionB": "<choice B>",
  "optionC": "<choice C>",
  "optionD": "<choice D>",
  "correctAnswer": "A" | "B" | "C" | "D",
  "explanation": "<detailed explanation>",
  "difficulty": "foundational" | "easy" | "medium" | "hard"
}`;

const DEFAULT_VAL_PROMPT = `You are an MCAT content auditor. You will receive a JSON object with two fields: "question" (the generated question) and "requestedSubType" (the subtype label it was supposed to match). Review the question for:
1. Factual accuracy — flag any scientific errors
2. Answer key correctness — verify the stated correct answer is actually correct
3. Distractor quality — flag if distractors are implausible or if multiple choices could be correct
4. MCAT alignment — flag if the question tests knowledge outside MCAT scope
5. Subtype alignment — verify the question genuinely matches the requested subtype's format and cognitive demand

Output ONLY valid JSON:
{
  "pass": true | false,
  "flags": ["<issue 1>", "<issue 2>"],
  "corrected_question": { <full corrected question JSON, identical shape to the input question, or null if pass=true> }
}`;

const IMAGE_GENERATION_PROMPT = `You are an expert MCAT question writer who creates figure-based questions requiring visual interpretation of scientific data.

You will receive a request specifying a section, subtype, and difficulty. Generate a high-quality MCAT-style question where a figure (graph, diagram, table, or experimental setup) is ESSENTIAL to answering correctly.

**Auto-selecting a topic:** Choose the canonical topic that best fits the requested section and subtype. Do not ask for one — pick it yourself.

Chem/Phys: Atomic Structure | Periodic Trends | Bonding & Intermolecular Forces | Acids & Bases | Electrochemistry | Thermodynamics & Thermochemistry | Kinetics & Equilibrium | Solutions & Colligative Properties | Nuclear Chemistry | Kinematics & Dynamics | Work, Energy & Power | Fluids & Pressure | Electricity & Magnetism | Circuits | Waves & Sound | Optics & Light | Functional Groups & Nomenclature | Stereochemistry & Chirality | Reaction Mechanisms | Lab Techniques & Separations

Bio/Biochem: Amino Acids, Proteins & Enzymes | Enzyme Kinetics & Inhibition | Metabolism: Glycolysis & Fermentation | Metabolism: TCA Cycle & Oxidative Phosphorylation | Lipid Metabolism | DNA & RNA Structure | DNA Replication & Repair | Transcription & RNA Processing | Translation & Post-Translational Modification | Gene Regulation & Epigenetics | Recombinant DNA & Biotechnology | Cell Structure & Organelles | Cell Membrane & Transport | Cell Signaling & Signal Transduction | Cell Cycle & Mitosis | Meiosis & Gametogenesis | Mendelian Genetics & Heredity | Chromosomal Inheritance | Molecular Genetics & Mutations | Population Genetics | Nervous System & Neurophysiology | Endocrine System | Cardiovascular System | Respiratory System | Renal & Urinary System | Digestive System & Nutrition | Musculoskeletal System | Immune System & Inflammation | Reproductive System | Microbiology (Bacteria, Viruses, Fungi) | Evolution & Natural Selection

Psych/Soc: Biological Bases of Behavior | Sensation & Perception | Learning & Conditioning | Memory & Cognition | Language & Thought | Motivation, Emotion & Stress | Developmental Psychology | Personality Theories | Psychological Disorders | Treatment & Therapeutic Approaches | Social Structure & Institutions | Culture & Norms | Socialization & Social Learning | Social Stratification & Inequality | Demographics & Social Change | Social Behavior & Influence

**Subtype definitions — generate a question that matches the requested type exactly:**

Chem/Phys subtypes:
- Passage-Based Experimental Analysis: Lab experiment scenario with a figure showing apparatus or setup. Test identification of variables, hypothesis, and prediction of how changing a condition alters results.
- Data Interpretation (Graphs, Tables, Figures): Analyse a line graph, table, or scientific figure. Ask about trends, extrapolation, or cross-dataset comparison linked to a scientific principle.
- Biological Applications of Physical Science: Apply a physical principle to a biological system with a supporting diagram (e.g., fluid dynamics graph for blood vessels, neuron circuit diagram).

Bio/Biochem subtypes:
- Passage-Based Research Analysis: Interpret a biology or biochemistry experiment using a figure (gel, blot, growth curve). Combine passage information with prior biological knowledge.
- Mechanism and Pathway Questions: Test how a process works using a pathway diagram or reaction scheme. Predict effects of inhibition, mutation, or a missing step.
- Data Interpretation (Experimental Results): Analyse a protein activity graph, gene expression heatmap, or gel/blot result. Identify patterns and connect findings to biological function.
- Structure–Function Relationships: Connect molecular or cellular structure to biological role using a diagram or molecular model.

Psych/Soc subtypes:
- Research Design and Data Interpretation: Analyse a human behaviour or social trends study using a graph or table of results. Identify variables, evaluate conclusions, or interpret statistics.

**Figure requirements:**
- The stem MUST reference the figure explicitly (e.g. "Based on the graph in Figure 1...", "According to the experimental setup shown...", "What does the data in Figure 1 indicate about...")
- Include a 2–4 sentence passage describing the experimental context that produced the figure
- Write four plausible answer choices (A–D) with exactly one correct answer
- Provide a detailed explanation referencing what the figure shows and why each distractor is wrong
- The figure_prompt must describe a scientifically accurate, publication-quality figure: specify chart type (line graph/bar chart/scatter plot/gel/diagram/experimental setup), axis labels with units, data trends, key features, clean white background, no text overlays except axis labels

Output ONLY valid JSON in this exact shape:
{
  "section": "Chem/Phys" | "CARS" | "Bio/Biochem" | "Psych/Soc",
  "topic": "<canonical topic auto-selected for this section and subtype>",
  "passage": "<experimental context, 2–4 sentences>",
  "stem": "<question stem explicitly referencing Figure 1>",
  "optionA": "<choice A>",
  "optionB": "<choice B>",
  "optionC": "<choice C>",
  "optionD": "<choice D>",
  "correctAnswer": "A" | "B" | "C" | "D",
  "explanation": "<detailed explanation referencing what the figure shows>",
  "difficulty": "foundational" | "easy" | "medium" | "hard",
  "figure_prompt": "<detailed image generation prompt: chart type, axis labels with units, data trends, key features, clean white background, publication-quality scientific style, no text overlays except axis labels>"
}`;

const IMAGE_VALIDATION_PROMPT = `You are an MCAT content auditor reviewing image-based questions. You will receive a JSON object with two fields: "question" (the generated question) and "requestedSubType" (the subtype label it was supposed to match). Review for:
1. Factual accuracy — flag any scientific errors
2. Answer key correctness — verify the correct answer requires interpreting the described figure
3. Figure necessity — the figure must be ESSENTIAL; flag if the question can be answered without it
4. figure_prompt quality — verify it describes a specific, scientifically accurate figure with clear axes/labels/data
5. Distractor quality — flag if multiple choices could be correct or distractors are implausible
6. MCAT alignment — flag if outside MCAT scope
7. Subtype alignment — verify the question genuinely matches the requested subtype's format and cognitive demand

Output ONLY valid JSON:
{
  "pass": true | false,
  "flags": ["<issue 1>", "<issue 2>"],
  "corrected_question": { <full corrected question JSON including figure_prompt, or null if pass=true> }
}`;

const DEFAULT_AUDIT_PROMPT = `You are an expert MCAT content auditor. You will receive an MCAT practice question in JSON format. Perform a complete content accuracy and validity audit to detect hallucinations or incorrect material.

Check the following:
1. Factual accuracy — verify all scientific claims, facts, processes, and numbers are correct for MCAT-level content
2. Answer key correctness — verify the marked correct answer is genuinely correct
3. Distractor quality — ensure wrong answers are plausible but clearly incorrect; flag if any wrong answer could also be correct
4. Explanation accuracy — verify the explanation correctly justifies the answer and contains no errors
5. Internal consistency — ensure the passage, stem, options, and explanation are logically consistent
6. MCAT alignment — verify content falls within MCAT scope and appropriate difficulty

If you find NO issues, respond with ONLY this JSON:
{ "pass": true, "issues": [], "corrected_question": null }

If you find any issues, respond with ONLY this JSON (include only changed fields in corrected_question):
{
  "pass": false,
  "issues": ["<specific concise description of issue 1>", "<specific concise description of issue 2>"],
  "corrected_question": {
    "stem": "<corrected stem, only if changed>",
    "passage": "<corrected passage, only if changed>",
    "optionA": "<corrected A, only if changed>",
    "optionB": "<corrected B, only if changed>",
    "optionC": "<corrected C, only if changed>",
    "optionD": "<corrected D, only if changed>",
    "correctAnswer": "<corrected answer letter, only if changed>",
    "explanation": "<corrected explanation, only if changed>"
  }
}

Output ONLY valid JSON. No markdown, no preamble.`;

type PromptKey = "generation_prompt" | "validation_prompt" | "image_generation_prompt" | "image_validation_prompt" | "audit_prompt";

const PROMPT_LABELS: Record<PromptKey, string> = {
  generation_prompt:       "Generation Prompt (GENERATION_SYSTEM_PROMPT)",
  validation_prompt:       "Validation Prompt (VALIDATION_SYSTEM_PROMPT)",
  image_generation_prompt: "Image Generation Prompt (IMAGE_GENERATION_PROMPT)",
  image_validation_prompt: "Image Validation Prompt (IMAGE_VALIDATION_PROMPT)",
  audit_prompt:            "Audit Prompt (AUDIT_SYSTEM_PROMPT)",
};

const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  generation_prompt:       DEFAULT_GEN_PROMPT,
  validation_prompt:       DEFAULT_VAL_PROMPT,
  image_generation_prompt: IMAGE_GENERATION_PROMPT,
  image_validation_prompt: IMAGE_VALIDATION_PROMPT,
  audit_prompt:            DEFAULT_AUDIT_PROMPT,
};

const GH_SECTIONS = ["Chem/Phys", "CARS", "Bio/Biochem", "Psych/Soc"] as const;
const GH_DIFFICULTIES = ["foundational", "easy", "medium", "hard"] as const;

interface GhSectionCfg {
  targetPerTopicSubtype: number;
  targetPerDifficulty: Record<string, number>;
}
interface GhCfg {
  dedupThreshold: number;
  concurrency: number;
  passageSetsEnabled: boolean;
  resumePreviousRun: boolean;
  sections: Record<string, GhSectionCfg>;
}

function PinModal({
  label, onUnlock, onCancel,
}: {
  label: string;
  onUnlock: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin]     = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);
  const inputRef          = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit() {
    if (!pin.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) { onUnlock(); }
      else { setError("Incorrect PIN."); setPin(""); inputRef.current?.focus(); }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
        <div>
          <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--text-primary)" }}>Enter PIN to edit</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
        </div>
        <input
          ref={inputRef}
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="PIN"
          className="w-full px-3 py-2 rounded-lg text-sm font-mono tracking-widest"
          style={{ background: "var(--bg-input)", border: `1px solid ${error ? "#e05c5c" : "var(--border)"}`, color: "var(--text-primary)", outline: "none" }}
        />
        {error && <p className="text-xs" style={{ color: "#e05c5c" }}>{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={busy || !pin.trim()}
            className="flex-1 py-2 rounded-lg text-sm font-semibold"
            style={{ background: "var(--accent-blue)", color: "#fff", opacity: busy || !pin.trim() ? 0.5 : 1 }}
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsTab() {
  const [prompts, setPrompts]   = useState<Record<PromptKey, string>>({
    generation_prompt:       DEFAULT_GEN_PROMPT,
    validation_prompt:       DEFAULT_VAL_PROMPT,
    image_generation_prompt: IMAGE_GENERATION_PROMPT,
    image_validation_prompt: IMAGE_VALIDATION_PROMPT,
    audit_prompt:            DEFAULT_AUDIT_PROMPT,
  });
  const [locked, setLocked]     = useState<Record<PromptKey, boolean>>({
    generation_prompt: true, validation_prompt: true,
    image_generation_prompt: true, image_validation_prompt: true,
    audit_prompt: true,
  });
  const [pinTarget, setPinTarget] = useState<PromptKey | null>(null);
  const [saving, setSaving]     = useState<PromptKey | null>(null);
  const [saved, setSaved]       = useState<PromptKey | null>(null);
  // Keep a snapshot to allow cancel-revert
  const savedSnapshot           = useRef<Record<PromptKey, string>>({ ...PROMPT_DEFAULTS });

  const [models, setModels]           = useState<ModelConfig[]>([]);
  const [modelForm, setModelForm]     = useState(EMPTY_FORM);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError]   = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [showKey, setShowKey]         = useState<Record<string, boolean>>({});
  const apiKeyRef                     = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editForm, setEditForm]       = useState(EMPTY_FORM);
  const [editSaving, setEditSaving]   = useState(false);
  const [editError, setEditError]     = useState<string | null>(null);

  const [firestoreTest, setFirestoreTest]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [firestoreTesting, setFirestoreTesting] = useState(false);
  const [modelTests, setModelTests]   = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [testingId, setTestingId]     = useState<string | null>(null);

  // GitHub Config state
  const [ghOpen, setGhOpen]               = useState(false);
  const [ghLoading, setGhLoading]         = useState(false);
  const [ghTokenSet, setGhTokenSet]       = useState(false);
  const [ghEditCfg, setGhEditCfg]         = useState<GhCfg | null>(null);
  const [ghSaving, setGhSaving]           = useState(false);
  const [ghSaveMsg, setGhSaveMsg]         = useState("");
  const [ghTokenInput, setGhTokenInput]   = useState("");
  const [ghTokenMsg, setGhTokenMsg]       = useState("");
  const [ghSavingToken, setGhSavingToken] = useState(false);
  const [ghShowTokenField, setGhShowTokenField] = useState(false);
  const ghLoaded = useRef(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((d: { settings: Record<string, string> }) => {
        setPrompts((prev) => {
          const next = { ...prev };
          (Object.keys(PROMPT_DEFAULTS) as PromptKey[]).forEach((k) => {
            if (d.settings[k]) next[k] = d.settings[k];
          });
          savedSnapshot.current = { ...next };
          return next;
        });
      })
      .catch(() => {});

    fetch("/api/admin/models")
      .then((r) => r.json())
      .then((d: { models?: ModelConfig[] }) => { if (d.models) setModels(d.models); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ghOpen || ghLoaded.current) return;
    ghLoaded.current = true;
    setGhLoading(true);
    fetch("/api/admin/automation")
      .then((r) => r.json())
      .then((d: { config: GhCfg; githubTokenSet: boolean }) => {
        setGhTokenSet(d.githubTokenSet);
        setGhEditCfg(d.config);
      })
      .catch(() => {})
      .finally(() => setGhLoading(false));
  }, [ghOpen]);

  async function ghSaveToken() {
    if (!ghTokenInput.trim()) return;
    setGhSavingToken(true); setGhTokenMsg("");
    try {
      const res = await fetch("/api/admin/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_token", token: ghTokenInput }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) {
        setGhTokenMsg("Token saved");
        setGhTokenInput("");
        setGhShowTokenField(false);
        setGhTokenSet(true);
      } else {
        setGhTokenMsg(json.error ?? "Error");
      }
    } catch { setGhTokenMsg("Error saving token"); }
    finally { setGhSavingToken(false); setTimeout(() => setGhTokenMsg(""), 4000); }
  }

  async function ghSaveConfig() {
    if (!ghEditCfg) return;
    setGhSaving(true); setGhSaveMsg("");
    try {
      await fetch("/api/admin/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_config", config: ghEditCfg }),
      });
      setGhSaveMsg("Saved");
    } catch { setGhSaveMsg("Error saving"); }
    finally { setGhSaving(false); setTimeout(() => setGhSaveMsg(""), 3000); }
  }

  function ghUpdateTarget(section: string, diff: string, val: number) {
    if (!ghEditCfg) return;
    setGhEditCfg({
      ...ghEditCfg,
      sections: {
        ...ghEditCfg.sections,
        [section]: {
          ...ghEditCfg.sections[section],
          targetPerDifficulty: { ...ghEditCfg.sections[section].targetPerDifficulty, [diff]: val },
        },
      },
    });
  }

  function parseMaxTokensInput(s: string): number | undefined {
    if (!s.trim()) return undefined;
    if (s.trim().toUpperCase() === "INF") return -1;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  async function addModel() {
    if (!modelForm.name.trim() || !modelForm.modelId.trim()) {
      setModelError("Name and Model ID are required.");
      return;
    }
    setModelSaving(true);
    setModelError(null);
    try {
      const payload = {
        ...modelForm,
        maxTokens:          parseMaxTokensInput(modelForm.maxTokens),
        maxReasoningTokens: modelForm.maxReasoningTokens ? parseInt(modelForm.maxReasoningTokens, 10) : undefined,
      };
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { model?: ModelConfig; error?: string };
      if (!res.ok) { setModelError(data.error ?? "Failed to save"); return; }
      setModels((prev) => [...prev, data.model!]);
      setModelForm(EMPTY_FORM);
    } catch {
      setModelError("Network error");
    } finally {
      setModelSaving(false);
    }
  }

  async function removeModel(id: string) {
    setDeletingId(id);
    try {
      await fetch("/api/admin/models", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setModels((prev) => prev.filter((m) => m.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  async function updateRole(id: string, role: ModelRole) {
    setUpdatingRoleId(id);
    setModels((prev) => prev.map((m) => m.id === id ? { ...m, role } : m));
    try {
      await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role }),
      });
    } finally {
      setUpdatingRoleId(null);
    }
  }

  function startEdit(m: ModelConfig) {
    setEditingId(m.id);
    setEditForm({
      name: m.name, modelId: m.modelId, baseUrl: m.baseUrl, apiKey: m.apiKey, role: m.role,
      maxTokens: m.maxTokens === -1 ? "INF" : m.maxTokens ? String(m.maxTokens) : "",
      maxReasoningTokens: m.maxReasoningTokens ? String(m.maxReasoningTokens) : "",
    });
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editForm.name.trim() || !editForm.modelId.trim()) {
      setEditError("Name and Model ID are required.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const parsedMaxTokens          = parseMaxTokensInput(editForm.maxTokens);
      // null (not undefined) so JSON.stringify includes the key and the server clears the field
      const parsedMaxReasoningTokens = editForm.maxReasoningTokens ? parseInt(editForm.maxReasoningTokens, 10) : null;
      const res = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: editForm.name, modelId: editForm.modelId, baseUrl: editForm.baseUrl, apiKey: editForm.apiKey, maxTokens: parsedMaxTokens, maxReasoningTokens: parsedMaxReasoningTokens }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setEditError(data.error ?? "Failed to save"); return; }
      setModels((prev) => prev.map((m) => m.id === id ? { ...m, name: editForm.name, modelId: editForm.modelId, baseUrl: editForm.baseUrl, apiKey: editForm.apiKey, maxTokens: parsedMaxTokens, maxReasoningTokens: parsedMaxReasoningTokens ?? undefined } : m));
      setEditingId(null);
    } catch {
      setEditError("Network error");
    } finally {
      setEditSaving(false);
    }
  }

  async function testFirestore() {
    setFirestoreTesting(true);
    setFirestoreTest(null);
    try {
      const res = await fetch("/api/admin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "firestore" }),
      });
      const d = await res.json() as { ok: boolean; error?: string };
      setFirestoreTest({ ok: d.ok, msg: d.ok ? "Connected" : (d.error ?? "Failed") });
    } catch {
      setFirestoreTest({ ok: false, msg: "Network error" });
    } finally {
      setFirestoreTesting(false);
    }
  }

  async function testModel(m: ModelConfig) {
    setTestingId(m.id);
    setModelTests((t) => { const n = { ...t }; delete n[m.id]; return n; });
    try {
      const res = await fetch("/api/admin/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "model", modelId: m.modelId, baseUrl: m.baseUrl, apiKey: m.apiKey }),
      });
      const d = await res.json() as { ok: boolean; error?: string };
      setModelTests((t) => ({ ...t, [m.id]: { ok: d.ok, msg: d.ok ? "Connected" : (d.error ?? "Failed") } }));
    } catch {
      setModelTests((t) => ({ ...t, [m.id]: { ok: false, msg: "Network error" } }));
    } finally {
      setTestingId(null);
    }
  }

  function unlockPrompt(key: PromptKey) {
    savedSnapshot.current = { ...prompts };
    setLocked((l) => ({ ...l, [key]: false }));
    setPinTarget(null);
  }

  function cancelEdit(key: PromptKey) {
    setPrompts((p) => ({ ...p, [key]: savedSnapshot.current[key] }));
    setLocked((l) => ({ ...l, [key]: true }));
  }

  async function lockAndSave(key: PromptKey) {
    setSaving(key);
    try {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: prompts[key] }),
      });
      savedSnapshot.current = { ...prompts };
      setSaved(key);
      setLocked((l) => ({ ...l, [key]: true }));
      setTimeout(() => setSaved((s) => s === key ? null : s), 2000);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">

      {/* Card 2: Firestore Integration */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-3.5" style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Firestore Integration</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Firestore stores the question bank, custom AI models, and practice session data. It is activated automatically when{" "}
            <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-elevated)" }}>FIREBASE_SERVICE_ACCOUNT</code>{" "}
            is set.
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg px-4 py-3 space-y-1.5 text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <p style={{ color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>FIREBASE_SERVICE_ACCOUNT</strong> — base64-encoded service account JSON. Set on Vercel; the project ID and credentials are read directly from this value.
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              <strong>FIREBASE_STORAGE_BUCKET</strong> (optional) — defaults to{" "}
              <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-card)" }}>{"{project_id}.firebasestorage.app"}</code>.
              Only required if your bucket uses a non-default name.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={testFirestore}
              disabled={firestoreTesting}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              {firestoreTesting ? "Testing…" : "Test Connection"}
            </button>
            {firestoreTest && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: firestoreTest.ok ? "rgba(74,222,128,0.12)" : "rgba(224,92,92,0.12)",
                  color: firestoreTest.ok ? "#4ade80" : "#e05c5c",
                  border: `1px solid ${firestoreTest.ok ? "rgba(74,222,128,0.3)" : "rgba(224,92,92,0.3)"}`,
                }}
              >
                {firestoreTest.ok ? "✓ " : "✗ "}{firestoreTest.msg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Card 3: Custom Models */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-3.5" style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Custom Models</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Configure additional AI models with their own API keys and base URLs. Stored in Firebase Firestore.
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">

          {/* Existing models list */}
          {models.length > 0 && (
            <div className="space-y-2">
              {models.map((m) => (
                <div
                  key={m.id}
                  className="px-3 py-2.5 rounded-lg"
                  style={{ background: "var(--bg-input)", border: `1px solid ${editingId === m.id ? "var(--accent-blue)" : "var(--border)"}` }}
                >
                  {editingId === m.id ? (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Name <span style={{ color: "#e05c5c" }}>*</span></label>
                          <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded text-xs"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                        </div>
                        <div>
                          <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Model ID <span style={{ color: "#e05c5c" }}>*</span></label>
                          <input type="text" value={editForm.modelId} onChange={(e) => setEditForm(f => ({ ...f, modelId: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded text-xs font-mono"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Base URL</label>
                        <input type="text" value={editForm.baseUrl} onChange={(e) => setEditForm(f => ({ ...f, baseUrl: e.target.value }))}
                          className="w-full px-2 py-1.5 rounded text-xs font-mono"
                          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>API Key</label>
                          <input type="password" value={editForm.apiKey} onChange={(e) => setEditForm(f => ({ ...f, apiKey: e.target.value }))}
                            placeholder="Leave blank to keep existing"
                            className="w-full px-2 py-1.5 rounded text-xs font-mono"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                        </div>
                        <div>
                          <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Max Tokens <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(or INF)</span></label>
                          <input type="text" inputMode="numeric" value={editForm.maxTokens} onChange={(e) => setEditForm(f => ({ ...f, maxTokens: e.target.value }))}
                            placeholder="32000 or INF"
                            className="w-full px-2 py-1.5 rounded text-xs font-mono"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Max Reasoning Tokens <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(caps thinking budget — leave blank for non-reasoning models)</span></label>
                        <input type="number" value={editForm.maxReasoningTokens} onChange={(e) => setEditForm(f => ({ ...f, maxReasoningTokens: e.target.value }))}
                          placeholder="e.g. 8000 for DeepSeek Flash / V4 Pro"
                          className="w-full px-2 py-1.5 rounded text-xs font-mono"
                          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }} />
                      </div>
                      {editError && <p className="text-xs" style={{ color: "#e05c5c" }}>{editError}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(m.id)} disabled={editSaving}
                          className="px-3 py-1.5 rounded text-xs font-semibold"
                          style={{ background: "var(--accent-blue)", color: "#fff", opacity: editSaving ? 0.6 : 1 }}>
                          {editSaving ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => { setEditingId(null); setEditError(null); }}
                          className="px-3 py-1.5 rounded text-xs font-medium"
                          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{m.name}</p>
                        <p className="text-xs font-mono truncate" style={{ color: "var(--text-muted)" }}>{m.modelId}</p>
                        {m.baseUrl && (
                          <p className="text-xs font-mono truncate" style={{ color: "var(--text-muted)" }}>{m.baseUrl}</p>
                        )}
                        {m.maxTokens !== undefined && m.maxTokens !== null && (
                          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                            max tokens: <span style={{ color: "var(--text-primary)" }}>{m.maxTokens === -1 ? "INF" : m.maxTokens.toLocaleString()}</span>
                          </p>
                        )}
                        {m.apiKey && (
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                              {showKey[m.id] ? m.apiKey : `${"•".repeat(Math.min(16, m.apiKey.length - 4))}${m.apiKey.slice(-4)}`}
                            </p>
                            <button
                              onClick={() => setShowKey((s) => ({ ...s, [m.id]: !s[m.id] }))}
                              className="text-xs"
                              style={{ color: "var(--accent-blue)" }}
                            >
                              {showKey[m.id] ? "hide" : "show"}
                            </button>
                          </div>
                        )}
                        <div className="pt-1">
                          {(() => {
                            const roles = parseRoles(m.role);
                            const takenRoles = new Set<string>(
                              models
                                .filter(x => x.id !== m.id)
                                .flatMap(x => Array.from(parseRoles(x.role)))
                            );
                            const isUpdating = updatingRoleId === m.id;
                            function toggleRole(roleKey: string) {
                              const next = new Set(roles);
                              if (next.has(roleKey)) next.delete(roleKey); else next.add(roleKey);
                              updateRole(m.id, serializeRoles(next));
                            }
                            return (
                              <div className="flex flex-col gap-1">
                                {ROLE_OPTIONS.map(({ key, label }) => {
                                  const checked = roles.has(key);
                                  const taken   = !checked && takenRoles.has(key);
                                  return (
                                    <label key={key} className="flex items-center gap-2 select-none"
                                      style={{ cursor: isUpdating || taken ? "not-allowed" : "pointer", opacity: taken ? 0.45 : 1 }}>
                                      <input type="checkbox" checked={checked} disabled={isUpdating || taken}
                                        onChange={() => toggleRole(key)} />
                                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                        {label}{taken ? " (taken)" : ""}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="ml-3 flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => startEdit(m)}
                            className="px-2.5 py-1 rounded text-xs font-semibold"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => testModel(m)}
                            disabled={testingId === m.id}
                            className="px-2.5 py-1 rounded text-xs font-semibold"
                            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                          >
                            {testingId === m.id ? "…" : "Test"}
                          </button>
                          <button
                            onClick={() => removeModel(m.id)}
                            disabled={deletingId === m.id}
                            className="px-2.5 py-1 rounded text-xs font-semibold"
                            style={{ background: "rgba(224,92,92,0.12)", color: "#e05c5c", border: "1px solid rgba(224,92,92,0.3)" }}
                          >
                            {deletingId === m.id ? "…" : "Remove"}
                          </button>
                        </div>
                        {modelTests[m.id] && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: modelTests[m.id].ok ? "rgba(74,222,128,0.12)" : "rgba(224,92,92,0.12)",
                              color: modelTests[m.id].ok ? "#4ade80" : "#e05c5c",
                              border: `1px solid ${modelTests[m.id].ok ? "rgba(74,222,128,0.3)" : "rgba(224,92,92,0.3)"}`,
                            }}
                          >
                            {modelTests[m.id].ok ? "✓ " : "✗ "}{modelTests[m.id].msg}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {models.length === 0 && (
            <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)" }}>No custom models configured yet.</p>
          )}

          {/* Add model form */}
          <div className="space-y-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider pt-2" style={{ color: "var(--text-muted)" }}>Add Model</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Name <span style={{ color: "#e05c5c" }}>*</span></label>
                <input
                  type="text"
                  value={modelForm.name}
                  onChange={(e) => setModelForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="GPT-4o"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Model ID <span style={{ color: "#e05c5c" }}>*</span></label>
                <input
                  type="text"
                  value={modelForm.modelId}
                  onChange={(e) => setModelForm((f) => ({ ...f, modelId: e.target.value }))}
                  placeholder="gpt-4o"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Base URL</label>
              <input
                type="text"
                value={modelForm.baseUrl}
                onChange={(e) => setModelForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>API Key</label>
                <input
                  ref={apiKeyRef}
                  type="password"
                  value={modelForm.apiKey}
                  onChange={(e) => setModelForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Max Tokens <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(or INF for unlimited)</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={modelForm.maxTokens}
                  onChange={(e) => setModelForm((f) => ({ ...f, maxTokens: e.target.value }))}
                  placeholder="32000 or INF"
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Max Reasoning Tokens <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional — caps thinking budget for reasoning models like DeepSeek Flash/V4 Pro)</span></label>
              <input
                type="number"
                value={modelForm.maxReasoningTokens}
                onChange={(e) => setModelForm((f) => ({ ...f, maxReasoningTokens: e.target.value }))}
                placeholder="e.g. 8000"
                className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>Roles</label>
              <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
                {ROLE_OPTIONS.map(({ key, label }) => {
                  const formRoles  = parseRoles(modelForm.role);
                  const takenRoles = new Set<string>(models.flatMap(x => Array.from(parseRoles(x.role))));
                  const checked = formRoles.has(key);
                  const taken   = !checked && takenRoles.has(key);
                  return (
                    <label key={key} className="flex items-center gap-2 select-none"
                      style={{ cursor: taken ? "not-allowed" : "pointer", opacity: taken ? 0.45 : 1 }}>
                      <input type="checkbox" checked={checked} disabled={taken}
                        onChange={() => {
                          const next = new Set(formRoles);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          setModelForm(f => ({ ...f, role: serializeRoles(next) }));
                        }} />
                      <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                        {label}{taken ? " (taken)" : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {modelError && (
              <p className="text-xs" style={{ color: "#e05c5c" }}>{modelError}</p>
            )}

            <button
              onClick={addModel}
              disabled={modelSaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: "var(--accent-blue)", color: "#fff" }}
            >
              {modelSaving ? "Saving…" : "Add Model"}
            </button>
          </div>
        </div>
      </div>

      {/* Card: GitHub Config */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <button
          className="w-full px-5 py-3.5 flex items-center justify-between text-left"
          style={{ background: "var(--bg-card)", borderBottom: ghOpen ? "1px solid var(--border)" : "none" }}
          onClick={() => setGhOpen((o) => !o)}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>GitHub Config</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              GitHub token and automation targets for background generation runs.
            </p>
          </div>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ color: "var(--text-muted)", flexShrink: 0, transform: ghOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {ghOpen && (
          <div className="px-5 py-4 space-y-5">
            {ghLoading ? (
              <p className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>Loading…</p>
            ) : (
              <>
                {/* Token */}
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>GitHub Token</p>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: ghTokenSet ? "rgba(74,222,128,0.12)" : "rgba(240,165,0,0.12)",
                        color: ghTokenSet ? "#4ade80" : "#f0a500",
                        border: `1px solid ${ghTokenSet ? "rgba(74,222,128,0.3)" : "rgba(240,165,0,0.3)"}`,
                      }}>
                      {ghTokenSet ? "Configured" : "Not set"}
                    </span>
                  </div>

                  {!ghShowTokenField ? (
                    <button onClick={() => setGhShowTokenField(true)} className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {ghTokenSet ? "Update token →" : "Set up token →"}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Create at github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
                        Grant <strong>Actions: Read and write</strong> on the mcatmastery repo.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={ghTokenInput}
                          onChange={(e) => setGhTokenInput(e.target.value)}
                          placeholder="github_pat_…"
                          className="flex-1 px-3 py-1.5 rounded-lg text-xs font-mono"
                          style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                        />
                        <button onClick={ghSaveToken} disabled={ghSavingToken || !ghTokenInput.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: "var(--accent-blue)", color: "#fff", opacity: ghSavingToken ? 0.6 : 1 }}>
                          {ghSavingToken ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => { setGhShowTokenField(false); setGhTokenInput(""); }}
                          className="px-3 py-1.5 rounded-lg text-xs"
                          style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                          Cancel
                        </button>
                      </div>
                      {ghTokenMsg && <p className="text-xs" style={{ color: ghTokenMsg === "Token saved" ? "#4ade80" : "#e05c5c" }}>{ghTokenMsg}</p>}
                    </div>
                  )}
                </div>

                {/* Automation config */}
                {ghEditCfg && (
                  <div className="space-y-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Automation Settings</p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {[
                        { label: "Concurrency",     key: "concurrency",    min: 1,    max: 10,   step: 1 },
                        { label: "Dedup Threshold", key: "dedupThreshold", min: 0.3,  max: 0.99, step: 0.01 },
                      ].map(({ label, key, min, max, step }) => (
                        <div key={key}>
                          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</label>
                          <input type="number" min={min} max={max} step={step}
                            value={(ghEditCfg as Record<string, unknown>)[key] as number}
                            onChange={(e) => setGhEditCfg({ ...ghEditCfg, [key]: parseFloat(e.target.value) })}
                            className="w-full px-3 py-2 rounded-lg text-sm"
                            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                          />
                        </div>
                      ))}

                      <div className="flex items-center gap-2 mt-5">
                        <input type="checkbox" checked={ghEditCfg.passageSetsEnabled}
                          onChange={(e) => setGhEditCfg({ ...ghEditCfg, passageSetsEnabled: e.target.checked })}
                          className="w-4 h-4" id="gh-passage-sets" />
                        <label htmlFor="gh-passage-sets" className="text-sm cursor-pointer" style={{ color: "var(--text-primary)" }}>Passage Sets</label>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
                        Target questions per difficulty (per topic × subtype slot)
                      </p>
                      <div className="space-y-3">
                        {GH_SECTIONS.map((section) => (
                          <div key={section}>
                            <div className="text-xs font-medium mb-1.5" style={{ color: SECTION_COLORS[section] }}>{section}</div>
                            <div className="grid grid-cols-4 gap-2">
                              {GH_DIFFICULTIES.map((diff) => (
                                <div key={diff}>
                                  <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>{diff}</label>
                                  <input type="number" min={0} max={100}
                                    value={ghEditCfg.sections[section]?.targetPerDifficulty[diff] ?? 0}
                                    onChange={(e) => ghUpdateTarget(section, diff, parseInt(e.target.value) || 0)}
                                    className="w-full px-2 py-1.5 rounded-lg text-xs"
                                    style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button onClick={ghSaveConfig} disabled={ghSaving}
                        className="px-4 py-2 rounded-lg text-sm font-semibold"
                        style={{ background: "var(--accent-blue)", color: "#fff", opacity: ghSaving ? 0.6 : 1 }}>
                        {ghSaving ? "Saving…" : "Save"}
                      </button>
                      {ghSaveMsg && <span className="text-xs" style={{ color: ghSaveMsg === "Saved" ? "#4ade80" : "#e05c5c" }}>{ghSaveMsg}</span>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Card 4: Generation Prompts */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-3.5" style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Generation Prompts</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            All prompts are PIN-protected. Click Edit on any prompt, enter your PIN, make changes, then Lock &amp; Save. Default PIN is <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-elevated)" }}>1234</code> — set <code className="px-1 py-0.5 rounded" style={{ background: "var(--bg-elevated)" }}>ADMIN_PROMPT_PIN</code> in environment variables to change it.
          </p>
        </div>
        <div className="px-5 py-4 space-y-5">

          {/* ── Text-Based ── */}
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Text-Based Questions</p>

          {(["generation_prompt", "validation_prompt"] as PromptKey[]).map((key) => (
            <PromptBlock
              key={key}
              promptKey={key}
              label={PROMPT_LABELS[key]}
              value={prompts[key]}
              locked={locked[key]}
              saving={saving === key}
              saved={saved === key}
              onEdit={() => setPinTarget(key)}
              onCancel={() => cancelEdit(key)}
              onLockSave={() => lockAndSave(key)}
              onChange={(v) => setPrompts((p) => ({ ...p, [key]: v }))}
            />
          ))}

          {/* ── Image-Based ── */}
          <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider pt-2 mb-5" style={{ color: "var(--text-muted)" }}>Image-Based Questions</p>

            {(["image_generation_prompt", "image_validation_prompt"] as PromptKey[]).map((key) => (
              <PromptBlock
                key={key}
                promptKey={key}
                label={PROMPT_LABELS[key]}
                value={prompts[key]}
                locked={locked[key]}
                saving={saving === key}
                saved={saved === key}
                onEdit={() => setPinTarget(key)}
                onCancel={() => cancelEdit(key)}
                onLockSave={() => lockAndSave(key)}
                onChange={(v) => setPrompts((p) => ({ ...p, [key]: v }))}
              />
            ))}
          </div>

          {/* ── Database Audit ── */}
          <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider pt-2 mb-5" style={{ color: "var(--text-muted)" }}>Database Audit</p>

            <PromptBlock
              promptKey="audit_prompt"
              label={PROMPT_LABELS.audit_prompt}
              value={prompts.audit_prompt}
              locked={locked.audit_prompt}
              saving={saving === "audit_prompt"}
              saved={saved === "audit_prompt"}
              onEdit={() => setPinTarget("audit_prompt")}
              onCancel={() => cancelEdit("audit_prompt")}
              onLockSave={() => lockAndSave("audit_prompt")}
              onChange={(v) => setPrompts((p) => ({ ...p, audit_prompt: v }))}
            />
          </div>

        </div>
      </div>

      {/* PIN modal */}
      {pinTarget && (
        <PinModal
          label={PROMPT_LABELS[pinTarget]}
          onUnlock={() => unlockPrompt(pinTarget)}
          onCancel={() => setPinTarget(null)}
        />
      )}

    </div>
  );
}

function PromptBlock({
  label, value, locked, saving, saved,
  onEdit, onCancel, onLockSave, onChange,
}: {
  promptKey: PromptKey;
  label: string;
  value: string;
  locked: boolean;
  saving: boolean;
  saved: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onLockSave: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <label className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          {label}
          {locked && (
            <span className="flex items-center gap-1 text-xs font-normal normal-case px-2 py-0.5 rounded-full"
              style={{ background: "rgba(99,102,241,0.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.25)" }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <rect x="2" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M4 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              Locked
            </span>
          )}
        </label>
        {locked ? (
          <button
            onClick={onEdit}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              onClick={onLockSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              style={{
                background: saved ? "rgba(74,222,128,0.15)" : "var(--accent-blue)",
                color: saved ? "#4ade80" : "#fff",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : saved ? "Saved ✓" : (
                <>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <rect x="2" y="5" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M4 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  Lock &amp; Save
                </>
              )}
            </button>
          </div>
        )}
      </div>
      <textarea
        value={value}
        readOnly={locked}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        className="w-full px-3 py-2 rounded-lg text-xs font-mono resize-y"
        style={{
          background: locked ? "var(--bg-elevated)" : "var(--bg-input)",
          border: `1px solid ${locked ? "var(--border)" : "var(--accent-blue)"}`,
          color: locked ? "var(--text-secondary)" : "var(--text-primary)",
          outline: "none",
          cursor: locked ? "default" : "text",
          transition: "border-color 0.15s, background 0.15s",
        }}
      />
    </div>
  );
}
