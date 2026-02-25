/**
 * Metadata for product attributes ("contains X") and claims ("X-free", marketing).
 *
 * Every value matches the `select` options in the Products collection config
 * (`productAttributes.attribute` and `productClaims.claim`).
 *
 * Icon names are Lucide icon identifiers — resolved inside the TraitChip client
 * component to avoid passing React components across the Server→Client boundary.
 */

export type TraitIcon =
  | 'alert-triangle'
  | 'wine'
  | 'wheat'
  | 'droplets'
  | 'flask-conical'
  | 'shield-alert'
  | 'test-tubes'
  | 'flower-2'
  | 'fuel'
  | 'leaf'
  | 'heart'
  | 'baby'
  | 'shield-check'
  | 'cloud-rain'
  | 'trash-2'
  | 'shield-off'
  | 'glass-water'

export interface TraitMeta {
  /** Short user-facing title */
  title: string
  /** One-sentence explanation shown in the info tooltip */
  description: string
  /** Lucide icon name (resolved in the client component) */
  icon: TraitIcon
  /** Visual tone: negative = orange/red-ish, positive = green-ish, neutral = grey */
  tone: 'positive' | 'negative' | 'neutral'
}

/* ------------------------------------------------------------------ */
/*  Attributes — "contains X"                                          */
/* ------------------------------------------------------------------ */

export const ATTRIBUTE_META: Record<string, TraitMeta> = {
  containsAllergens: {
    title: 'Allergens',
    description: 'Contains known allergens such as common fragrance allergens or MI/MCI.',
    icon: 'alert-triangle',
    tone: 'negative',
  },
  containsSimpleAlcohol: {
    title: 'Alcohol',
    description: 'Contains drying alcohols (Alcohol Denat., Ethanol, Isopropyl Alcohol).',
    icon: 'wine',
    tone: 'negative',
  },
  containsGluten: {
    title: 'Gluten',
    description: 'Contains gluten or gluten-derived ingredients.',
    icon: 'wheat',
    tone: 'negative',
  },
  containsSilicones: {
    title: 'Silicones',
    description: 'Contains silicones such as Dimethicone or Cyclomethicone.',
    icon: 'droplets',
    tone: 'neutral',
  },
  containsSulfates: {
    title: 'Sulfates',
    description: 'Contains sulfates such as SLS or SLES.',
    icon: 'flask-conical',
    tone: 'negative',
  },
  containsParabens: {
    title: 'Parabens',
    description: 'Contains parabens such as Methylparaben or Propylparaben.',
    icon: 'shield-alert',
    tone: 'negative',
  },
  containsPegs: {
    title: 'PEGs',
    description: 'Contains PEG compounds (Polyethylene Glycol derivatives).',
    icon: 'test-tubes',
    tone: 'negative',
  },
  containsFragrance: {
    title: 'Fragrance',
    description: 'Contains fragrance or parfum.',
    icon: 'flower-2',
    tone: 'neutral',
  },
  containsMineralOil: {
    title: 'Mineral Oil',
    description: 'Contains mineral oil or petroleum-derived oils.',
    icon: 'fuel',
    tone: 'negative',
  },
}

/* ------------------------------------------------------------------ */
/*  Claims — marketing / safety claims                                 */
/* ------------------------------------------------------------------ */

export const CLAIM_META: Record<string, TraitMeta> = {
  vegan: {
    title: 'Vegan',
    description: 'Marketed as vegan — no animal-derived ingredients.',
    icon: 'leaf',
    tone: 'positive',
  },
  crueltyFree: {
    title: 'Cruelty Free',
    description: 'Marketed as cruelty-free — not tested on animals.',
    icon: 'heart',
    tone: 'positive',
  },
  unsafeForPregnancy: {
    title: 'Unsafe in Pregnancy',
    description: 'Contains ingredients considered unsafe during pregnancy (e.g. retinoids).',
    icon: 'baby',
    tone: 'negative',
  },
  pregnancySafe: {
    title: 'Pregnancy Safe',
    description: 'Explicitly marketed as safe during pregnancy.',
    icon: 'shield-check',
    tone: 'positive',
  },
  waterProof: {
    title: 'Waterproof',
    description: 'Marketed as waterproof or water-resistant.',
    icon: 'cloud-rain',
    tone: 'positive',
  },
  microplasticFree: {
    title: 'Microplastic Free',
    description: 'Marketed as free from microplastics.',
    icon: 'trash-2',
    tone: 'positive',
  },
  allergenFree: {
    title: 'Allergen Free',
    description: 'Marketed as allergen-free or hypoallergenic.',
    icon: 'shield-off',
    tone: 'positive',
  },
  simpleAlcoholFree: {
    title: 'Alcohol Free',
    description: 'Marketed as free from drying alcohols.',
    icon: 'glass-water',
    tone: 'positive',
  },
  glutenFree: {
    title: 'Gluten Free',
    description: 'Marketed as gluten-free.',
    icon: 'wheat',
    tone: 'positive',
  },
  siliconeFree: {
    title: 'Silicone Free',
    description: 'Marketed as silicone-free.',
    icon: 'droplets',
    tone: 'positive',
  },
  sulfateFree: {
    title: 'Sulfate Free',
    description: 'Marketed as sulfate-free.',
    icon: 'flask-conical',
    tone: 'positive',
  },
  parabenFree: {
    title: 'Paraben Free',
    description: 'Marketed as paraben-free.',
    icon: 'shield-alert',
    tone: 'positive',
  },
  pegFree: {
    title: 'PEG Free',
    description: 'Marketed as PEG-free.',
    icon: 'test-tubes',
    tone: 'positive',
  },
  fragranceFree: {
    title: 'Fragrance Free',
    description: 'Marketed as fragrance-free.',
    icon: 'flower-2',
    tone: 'positive',
  },
  mineralOilFree: {
    title: 'Mineral Oil Free',
    description: 'Marketed as mineral-oil-free.',
    icon: 'fuel',
    tone: 'positive',
  },
}
