/**
 * Registry of EDUVERSE's own interactive 3D scenes used by textbook topics.
 * No model is loaded from the internet: every scene is drawn by our code.
 */
export type OwnSceneId =
  | 'lab' | 'measure' | 'motion' | 'forces' | 'solar'
  | 'particles' | 'ph' | 'mixtures'
  | 'cell' | 'body' | 'classify' | 'microbes' | 'foodweb' | 'leaf'
  | 'factors' | 'numberline' | 'balance' | 'geometry';

export type OwnScene = { kind: 'own'; scene: OwnSceneId; mode?: string };

export const own = (scene: OwnSceneId, mode?: string): OwnScene => ({ kind: 'own', scene, mode });

export const SCENE_GROUP: Record<OwnSceneId, 'physics' | 'chem' | 'bio' | 'math'> = {
  lab: 'physics', measure: 'physics', motion: 'physics', forces: 'physics', solar: 'physics',
  particles: 'chem', ph: 'chem', mixtures: 'chem',
  cell: 'bio', body: 'bio', classify: 'bio', microbes: 'bio', foodweb: 'bio', leaf: 'bio',
  factors: 'math', numberline: 'math', balance: 'math', geometry: 'math',
};
