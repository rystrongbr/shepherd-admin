/**
 * Crisis response payload builder.
 *
 * Builds the purpose-built My Shepherd response that REPLACES the normal
 * LLM answer when crisis language is detected. Response copy varies by
 * category so it feels human, not templated, but every variant includes:
 * compassionate acknowledgment, KJV Scripture, a primary + secondary crisis
 * resource, and a nudge to tell a trusted adult.
 *
 * ALL Scripture here is King James Version, verbatim. It matches My Shepherd's
 * core promise — do not paraphrase.
 *
 * Resource routing (confirmed by the founder):
 *   - Suicidal / self-harm / method / acute danger → 988 + Crisis Text Line.
 *   - Abuse disclosures → Childhelp (1-800-422-4453) + RAINN (1-800-656-4673),
 *     NOT 988.
 */

import type { CrisisCategory } from "./patterns";

export interface CrisisScripture {
  reference: string;
  text: string;
}

export interface CrisisResource {
  name: string;
  number: string;
  /** Human phrasing for the action, e.g. "call or text 988". Optional. */
  text_action?: string;
}

export interface CrisisResources {
  primary: CrisisResource;
  secondary: CrisisResource | null;
}

export type CrisisUrgency = "IMMEDIATE" | "HIGH" | "STANDARD";

export interface CrisisResponse {
  type: "crisis_safety";
  category: CrisisCategory;
  urgency: CrisisUrgency;
  acknowledgment: string;
  scripture_primary: CrisisScripture;
  scripture_secondary: CrisisScripture | null;
  resources: CrisisResources;
  trusted_adult_nudge: string;
  footer: string;
}

interface CrisisTemplate {
  acknowledgment: string;
  scripture: CrisisScripture;
  scripture_secondary: CrisisScripture | null;
  urgency?: CrisisUrgency;
  resources_override?: CrisisResources;
}

const CRISIS_RESPONSES: Record<CrisisCategory, CrisisTemplate> = {
  SUICIDAL_IDEATION: {
    acknowledgment:
      "I hear you. What you're carrying is real, and I don't want to send you a canned response. You matter. Not for what you produce, not for what you achieve — because you were made.",
    scripture: {
      reference: "Psalm 34:18",
      text: "The LORD is nigh unto them that are of a broken heart; and saveth such as be of a contrite spirit.",
    },
    scripture_secondary: {
      reference: "Matthew 11:28",
      text: "Come unto me, all ye that labour and are heavy laden, and I will give you rest.",
    },
  },
  SELF_HARM: {
    acknowledgment:
      "I hear you, and I'm not going to pretend I have a verse that fixes this in one message. What you're doing to yourself right now is a signal — your body is telling you something no one has yet heard. Please let someone hear it.",
    scripture: {
      reference: "Psalm 139:14",
      text: "I will praise thee; for I am fearfully and wonderfully made: marvellous are thy works; and that my soul knoweth right well.",
    },
    scripture_secondary: null,
  },
  METHOD_SEEKING: {
    acknowledgment:
      "I won't answer that question. Not because I don't care — because I do. If you're at the point of asking how, please stop reading me and call someone right now.",
    scripture: {
      reference: "Psalm 34:18",
      text: "The LORD is nigh unto them that are of a broken heart; and saveth such as be of a contrite spirit.",
    },
    scripture_secondary: null,
    urgency: "HIGH",
  },
  ACUTE_DANGER: {
    acknowledgment:
      "Please pause. Right now, before another second passes, call 988. You are not alone. You are not a burden. There is a real person on the other end of that number who is trained for this exact moment.",
    scripture: {
      reference: "Isaiah 41:10",
      text: "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness.",
    },
    scripture_secondary: null,
    urgency: "IMMEDIATE",
  },
  ABUSE_DISCLOSURE: {
    acknowledgment:
      "I hear you. What is happening to you is not okay, it is not your fault, and you were right to say it out loud. What you just did takes real courage.",
    scripture: {
      reference: "Psalm 27:10",
      text: "When my father and my mother forsake me, then the LORD will take me up.",
    },
    scripture_secondary: null,
    resources_override: {
      primary: { name: "Childhelp National Child Abuse Hotline", number: "1-800-422-4453" },
      secondary: { name: "RAINN National Sexual Assault Hotline", number: "1-800-656-4673" },
    },
  },
};

const DEFAULT_RESOURCES: CrisisResources = {
  primary: { name: "988 Suicide & Crisis Lifeline", number: "988", text_action: "call or text 988" },
  secondary: { name: "Crisis Text Line", number: "741741", text_action: "text HOME to 741741" },
};

const TRUSTED_ADULT_NUDGE =
  "Please tell one person who loves you what you told me. Not tomorrow — today. Your mom, your dad, a pastor, an aunt, a friend's parent, a teacher you trust. You do not have to carry this by yourself, and you were never meant to.";

const FOOTER =
  "My Shepherd is not a replacement for a doctor, counselor, or crisis professional. If you are in danger right now, call 988.";

/**
 * Build the crisis response payload for a detected category. Falls back to the
 * SUICIDAL_IDEATION template if an unknown category is somehow passed in.
 */
export function buildCrisisResponse(category: CrisisCategory): CrisisResponse {
  const template = CRISIS_RESPONSES[category] || CRISIS_RESPONSES.SUICIDAL_IDEATION;
  const resources = template.resources_override || DEFAULT_RESOURCES;

  return {
    type: "crisis_safety",
    category,
    urgency: template.urgency || "STANDARD",
    acknowledgment: template.acknowledgment,
    scripture_primary: template.scripture,
    scripture_secondary: template.scripture_secondary,
    resources,
    trusted_adult_nudge: TRUSTED_ADULT_NUDGE,
    footer: FOOTER,
  };
}
