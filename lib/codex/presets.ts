// Built-in Sub-Codex 1s, one per subject. The titles are the approved curriculum structure supplied by the
// owner and are used verbatim: Codex never renames, reorders or adds to them.

export interface SubCodexPreset {
  subject: string;
  sections: string[];
}

export const SUBCODEX_PRESETS: SubCodexPreset[] = [
  {
    subject: "Biology",
    sections: [
      "Molecular Biology and Genetics",
      "DNA Replication, Transcription, and Translation",
      "Gene Expression, Regulation, and Mutations",
      "Cell Structure and Function",
      "Cell Membranes and Transport",
      "Cell Cycle, Mitosis, and Meiosis",
      "Reproduction and Embryonic Development",
      "Evolution and Population Genetics",
      "Prokaryotes and Viruses",
      "Nervous System",
      "Endocrine System",
      "Cardiovascular and Respiratory Systems",
      "Digestive and Excretory Systems",
      "Immune and Lymphatic Systems",
      "Muscular, Skeletal, and Integumentary Systems",
      "Reproductive System and Homeostasis",
    ],
  },
  {
    subject: "Biochemistry",
    sections: [
      "Amino Acids, Peptides, and Proteins",
      "Protein Structure and Function",
      "Enzymes and Enzyme Kinetics",
      "Carbohydrates and Lipids",
      "Nucleotides and Nucleic Acids",
      "Bioenergetics and Biological Thermodynamics",
      "Glycolysis, Gluconeogenesis, and Glycogen Metabolism",
      "Pentose Phosphate Pathway and Citric Acid Cycle",
      "Electron Transport Chain and Oxidative Phosphorylation",
      "Fatty Acid and Amino Acid Metabolism",
      "Metabolic Regulation and Hormonal Control",
      "Biochemical Laboratory Techniques",
    ],
  },
  {
    subject: "General Chemistry",
    sections: [
      "Atomic Structure and Periodic Trends",
      "Chemical Bonding and Molecular Geometry",
      "Intermolecular Forces and Molecular Polarity",
      "Stoichiometry and Chemical Reactions",
      "Gases and Gas Laws",
      "Liquids, Solids, and Phase Changes",
      "Solutions, Solubility, and Colligative Properties",
      "Acids, Bases, Buffers, and Titrations",
      "Chemical Equilibrium",
      "Thermodynamics and Thermochemistry",
      "Chemical Kinetics",
      "Oxidation-Reduction and Electrochemistry",
    ],
  },
  {
    subject: "Organic Chemistry",
    sections: [
      "Molecular Structure, Bonding, and Resonance",
      "Nomenclature and Functional Groups",
      "Stereochemistry and Isomerism",
      "Acids, Bases, Nucleophiles, and Electrophiles",
      "Organic Reaction Mechanisms",
      "Substitution and Elimination Reactions",
      "Hydrocarbons, Alcohols, and Ethers",
      "Aldehydes and Ketones",
      "Carboxylic Acids and Their Derivatives",
      "Amines and Biologically Relevant Organic Compounds",
      "Oxidation and Reduction Reactions",
      "Spectroscopy and Structure Determination",
      "Organic Laboratory Techniques and Separation Methods",
    ],
  },
  {
    subject: "Physics",
    sections: [
      "Units, Vectors, and Dimensional Analysis",
      "Kinematics and Motion",
      "Forces and Newtonian Mechanics",
      "Work, Energy, and Power",
      "Momentum, Torque, and Equilibrium",
      "Fluid Statics and Fluid Dynamics",
      "Thermodynamics and Heat Transfer",
      "Electrostatics and Electric Fields",
      "Electric Circuits and Capacitance",
      "Magnetism",
      "Waves, Sound, and the Doppler Effect",
      "Light, Reflection, Refraction, and Optics",
      "Atomic and Nuclear Physics",
    ],
  },
  {
    subject: "Psychology",
    sections: [
      "Biological Bases of Behavior",
      "Sensation and Perception",
      "Consciousness, Sleep, and Attention",
      "Cognition, Memory, and Language",
      "Learning and Conditioning",
      "Motivation and Emotion",
      "Stress and Stress Responses",
      "Personality and Psychological Disorders",
      "Human Development and Behavioral Genetics",
      "Self-Concept and Identity",
      "Attitudes and Behavior Change",
      "Social Cognition and Social Influence",
      "Group Behavior and Interpersonal Relationships",
    ],
  },
  {
    subject: "Sociology",
    sections: [
      "Sociological Theories and Perspectives",
      "Culture and Socialization",
      "Social Structure, Status, and Roles",
      "Social Groups and Organizations",
      "Social Norms, Deviance, and Social Control",
      "Social Institutions",
      "Social Stratification and Social Mobility",
      "Race, Ethnicity, Gender, and Discrimination",
      "Demographics and Population Dynamics",
      "Social Change and Globalization",
      "Health Disparities and Social Determinants of Health",
      "Spatial Inequality and Residential Segregation",
    ],
  },
  {
    subject: "Critical Analysis and Reasoning Skills (CARS)",
    sections: [
      "Foundations of Comprehension",
      "Reasoning Within the Text",
      "Reasoning Beyond the Text",
    ],
  },
];

/** The preset as Sub-Codex text, ready for the parser. */
export function presetText(p: SubCodexPreset): string {
  return `Subject: ${p.subject}\n${p.sections.map((t, i) => `MS-${i + 1}: ${t}`).join("\n")}\n`;
}
