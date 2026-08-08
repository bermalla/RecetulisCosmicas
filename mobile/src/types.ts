export type Role = "owner" | "editor" | "reader";

export type Actor = {
  id: string;
  email: string;
  displayName: string;
  groupId: string;
  groupName: string;
  role: Role;
};

export type Ingredient = {
  id?: number;
  name: string;
  normalizedName?: string;
  quantity?: string | null;
  unit?: string | null;
  optional?: boolean;
  sortOrder?: number;
};

export type Recipe = {
  id: string;
  name: string;
  description: string;
  category: string;
  instructions: string[];
  nutrients: string[];
  durationMinutes?: number | null;
  servings?: number | null;
  image?: string | null;
  sourceUrl?: string | null;
  ingredients: Ingredient[];
  version?: number;
  updatedAt?: string;
  localOnly?: boolean;
};

export type RecipeChange = {
  sequence: number;
  recipeId: string;
  version: number;
  operation: "create" | "update" | "delete";
  recipe: Recipe | null;
};

export type Mode = "online" | "offline";
