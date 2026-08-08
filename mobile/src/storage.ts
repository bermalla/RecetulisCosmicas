import type { Recipe, RecipeChange } from "./types";

const DATABASE = "recetulis-cosmicas-mobile";
const VERSION = 1;
const RECIPES = "recipes";
const META = "meta";
export const GROUP_SCOPE = "group";
export const LOCAL_SCOPE = "local";

export function groupScope(groupId: string) {
  return `group:${groupId}`;
}

type StoredRecipe = Recipe & { scope: string; storageKey: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECIPES)) {
        const store = db.createObjectStore(RECIPES, { keyPath: "storageKey" });
        store.createIndex("scope", "scope", { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function readRecipes(scope: string): Promise<Recipe[]> {
  const db = await openDatabase();
  const tx = db.transaction(RECIPES, "readonly");
  const request = tx.objectStore(RECIPES).index("scope").getAll(scope);
  const rows = await new Promise<StoredRecipe[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as StoredRecipe[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.map((row) => {
    const recipe = { ...row } as Partial<StoredRecipe>;
    delete recipe.scope;
    delete recipe.storageKey;
    return recipe as Recipe;
  });
}

export async function replaceRecipes(scope: string, recipes: Recipe[]) {
  const db = await openDatabase();
  const tx = db.transaction(RECIPES, "readwrite");
  const store = tx.objectStore(RECIPES);
  const existing = store.index("scope").openKeyCursor(IDBKeyRange.only(scope));
  existing.onsuccess = () => {
    const cursor = existing.result;
    if (!cursor) {
      for (const recipe of recipes) store.put({ ...recipe, scope, storageKey: `${scope}:${recipe.id}` });
      return;
    }
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
  await complete(tx);
  db.close();
}

export async function putRecipe(scope: string, recipe: Recipe) {
  const db = await openDatabase();
  const tx = db.transaction(RECIPES, "readwrite");
  tx.objectStore(RECIPES).put({ ...recipe, scope, storageKey: `${scope}:${recipe.id}` });
  await complete(tx);
  db.close();
}

export async function applyChanges(scope: string, changes: RecipeChange[]) {
  const db = await openDatabase();
  const tx = db.transaction(RECIPES, "readwrite");
  const store = tx.objectStore(RECIPES);
  for (const change of changes) {
    const key = `${scope}:${change.recipeId}`;
    if (change.operation === "delete" || !change.recipe) store.delete(key);
    else store.put({ ...change.recipe, scope, storageKey: key });
  }
  await complete(tx);
  db.close();
}

export async function readCursor(scope: string) {
  const db = await openDatabase();
  const tx = db.transaction(META, "readonly");
  const request = tx.objectStore(META).get(`cursor:${scope}`);
  const row = await new Promise<{ value?: number } | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return Number(row?.value ?? 0);
}

export async function writeCursor(scope: string, value: number) {
  const db = await openDatabase();
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put({ key: `cursor:${scope}`, value });
  await complete(tx);
  db.close();
}
