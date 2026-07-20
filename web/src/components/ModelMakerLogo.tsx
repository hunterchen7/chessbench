import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?url"
import googleLogo from "@lobehub/icons-static-svg/icons/google.svg?url"
import inceptionLogo from "@lobehub/icons-static-svg/icons/inception.svg?url"
import metaLogo from "@lobehub/icons-static-svg/icons/meta.svg?url"
import minimaxLogo from "@lobehub/icons-static-svg/icons/minimax.svg?url"
import mistralLogo from "@lobehub/icons-static-svg/icons/mistral.svg?url"
import moonshotLogo from "@lobehub/icons-static-svg/icons/moonshot.svg?url"
import openaiLogo from "@lobehub/icons-static-svg/icons/openai.svg?url"
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen.svg?url"
import stepfunLogo from "@lobehub/icons-static-svg/icons/stepfun.svg?url"
import xaiLogo from "@lobehub/icons-static-svg/icons/xai.svg?url"
import type { ModelVariant } from "@/lib/data"
import { cn } from "@/lib/utils"

const MODEL_MAKERS: Record<string, { name: string; logo: string }> = {
  anthropic: { name: "Anthropic", logo: anthropicLogo },
  google: { name: "Google", logo: googleLogo },
  inception: { name: "Inception Labs", logo: inceptionLogo },
  "meta-llama": { name: "Meta", logo: metaLogo },
  minimax: { name: "MiniMax", logo: minimaxLogo },
  mistralai: { name: "Mistral AI", logo: mistralLogo },
  moonshotai: { name: "Moonshot AI", logo: moonshotLogo },
  openai: { name: "OpenAI", logo: openaiLogo },
  qwen: { name: "Qwen", logo: qwenLogo },
  stepfun: { name: "StepFun", logo: stepfunLogo },
  "x-ai": { name: "xAI", logo: xaiLogo },
}

function modelMaker(modelId: string) {
  return MODEL_MAKERS[modelId.split("/", 1)[0].toLowerCase()]
}

export function ModelMakerLogo({ variant, className }: { variant: ModelVariant; className?: string }) {
  const maker = modelMaker(variant.model_id)
  if (!maker) return null
  return <span
    aria-hidden="true"
    title={`${maker.name} model`}
    className={cn("inline-block size-4 shrink-0 bg-current", className)}
    style={{
      WebkitMaskImage: `url("${maker.logo}")`,
      WebkitMaskPosition: "center",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskSize: "contain",
      maskImage: `url("${maker.logo}")`,
      maskPosition: "center",
      maskRepeat: "no-repeat",
      maskSize: "contain",
    }}
  />
}

export function ModelName({ variant, className, logoClassName }: { variant: ModelVariant; className?: string; logoClassName?: string }) {
  return <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
    <ModelMakerLogo variant={variant} className={logoClassName} />
    <span className="truncate">{variant.display_name}</span>
  </span>
}
