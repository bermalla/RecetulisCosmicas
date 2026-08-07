export type OfflineRecipe = {
  id: string;
  name: string;
  description: string;
  category: string;
  instructions: string[];
  durationMinutes?: number | null;
  servings?: number | null;
  image?: string | null;
  sourceUrl?: string | null;
  nutrients: string[];
  ingredients: Array<{
    id?: number;
    name: string;
    normalizedName: string;
    quantity?: string | null;
    unit?: string | null;
    optional?: boolean;
    sortOrder?: number;
  }>;
  version?: number;
  localOnly?: boolean;
  updatedAt?: string;
};

export type RecipeChange = {
  sequence: number;
  recipeId: string;
  version: number;
  operation: "create" | "update" | "delete";
  recipe: OfflineRecipe | null;
};

const DB_NAME = "recetulis-cosmicas";
const DB_VERSION = 1;
const RECIPE_STORE = "recipes";
const META_STORE = "meta";
export const GROUP_SCOPE = "group";
export const LOCAL_SCOPE = "local";

type StoredRecipe = { key: string; scope: string; recipe: OfflineRecipe };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECIPE_STORE)) {
        const store = db.createObjectStore(RECIPE_STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function readRecipes(scope: string): Promise<OfflineRecipe[]> {
  const db = await openDatabase();
  const transaction = db.transaction(RECIPE_STORE, "readonly");
  const records = await requestResult(
    transaction.objectStore(RECIPE_STORE).index("scope").getAll(scope) as IDBRequest<StoredRecipe[]>,
  );
  db.close();
  return records.map((record) => record.recipe);
}

export async function replaceRecipes(scope: string, recipes: OfflineRecipe[]) {
  const db = await openDatabase();
  const transaction = db.transaction(RECIPE_STORE, "readwrite");
  const store = transaction.objectStore(RECIPE_STORE);
  const existing = await requestResult(
    store.index("scope").getAllKeys(scope) as IDBRequest<IDBValidKey[]>,
  );
  for (const key of existing) store.delete(key);
  for (const recipe of recipes) {
    store.put({ key: `${scope}:${recipe.id}`, scope, recipe } satisfies StoredRecipe);
  }
  await transactionDone(transaction);
  db.close();
}

export async function putRecipe(scope: string, recipe: OfflineRecipe) {
  const db = await openDatabase();
  const transaction = db.transaction(RECIPE_STORE, "readwrite");
  transaction.objectStore(RECIPE_STORE).put({
    key: `${scope}:${recipe.id}`,
    scope,
    recipe,
  } satisfies StoredRecipe);
  await transactionDone(transaction);
  db.close();
}

export async function removeRecipe(scope: string, recipeId: string) {
  const db = await openDatabase();
  const transaction = db.transaction(RECIPE_STORE, "readwrite");
  transaction.objectStore(RECIPE_STORE).delete(`${scope}:${recipeId}`);
  await transactionDone(transaction);
  db.close();
}

export async function applyRecipeChanges(scope: string, changes: RecipeChange[]) {
  const db = await openDatabase();
  const transaction = db.transaction(RECIPE_STORE, "readwrite");
  const store = transaction.objectStore(RECIPE_STORE);
  for (const change of changes) {
    const key = `${scope}:${change.recipeId}`;
    if (change.operation === "delete" || !change.recipe) store.delete(key);
    else store.put({ key, scope, recipe: change.recipe } satisfies StoredRecipe);
  }
  await transactionDone(transaction);
  db.close();
}

export async function readCursor(scope: string): Promise<number> {
  const db = await openDatabase();
  const transaction = db.transaction(META_STORE, "readonly");
  const value = await requestResult(transaction.objectStore(META_STORE).get(`cursor:${scope}`));
  db.close();
  return Number(value ?? 0);
}

export async function writeCursor(scope: string, cursor: number) {
  const db = await openDatabase();
  const transaction = db.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put(cursor, `cursor:${scope}`);
  await transactionDone(transaction);
  db.close();
}
