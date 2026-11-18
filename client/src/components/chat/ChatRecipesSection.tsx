import { BookOpen, CircleCheck, GitPullRequest, MessageSquare, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BUILTIN_CHAT_RECIPE_IDS } from '@baguette/shared/session-chat-recipes.js';
import ChatQuickActionButton, { CHAT_ACTION_BUTTON_CLASS } from './ChatQuickActionButton.tsx';

export type ChatRecipe = {
  id: string;
  label: string;
  description?: string | null;
  prompt: string;
  builtin: boolean;
};

const BUILTIN_RECIPE_ICONS: Record<string, LucideIcon> = {
  [BUILTIN_CHAT_RECIPE_IDS.GIT_SYNC]: GitPullRequest,
  [BUILTIN_CHAT_RECIPE_IDS.CHECK_CI]: CircleCheck,
  [BUILTIN_CHAT_RECIPE_IDS.CHECK_COMMENTS]: MessageSquare,
};

const BUILTIN_RECIPE_BUTTON_CLASS = CHAT_ACTION_BUTTON_CLASS;

const CUSTOM_RECIPE_BUTTON_CLASS = `${CHAT_ACTION_BUTTON_CLASS} border-dashed bg-inset/40 hover:bg-inset/70`;

type ChatRecipesSectionProps = {
  recipes: ChatRecipe[];
  disabled?: boolean;
  onRun: (prompt: string) => void;
};

export default function ChatRecipesSection({
  recipes,
  disabled = false,
  onRun,
}: ChatRecipesSectionProps) {
  if (!recipes.length) return null;

  return (
    <div
      data-testid="chat-recipes-section"
      className="flex flex-col gap-1.5 py-2 border-t border-line/80 mt-1"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint px-0.5">
        <BookOpen className="w-3 h-3 shrink-0" aria-hidden />
        Recipes
      </div>
      <div className="flex gap-2 flex-wrap" data-testid="chat-recipes-list">
        {recipes.map((recipe) => {
          const Icon = recipe.builtin ? BUILTIN_RECIPE_ICONS[recipe.id] : Sparkles;
          const tooltip = recipe.description || recipe.label;
          const className = recipe.builtin
            ? BUILTIN_RECIPE_BUTTON_CLASS
            : CUSTOM_RECIPE_BUTTON_CLASS;
          return (
            <ChatQuickActionButton
              key={recipe.id}
              icon={Icon}
              label={recipe.label}
              tooltip={tooltip}
              disabled={disabled}
              onClick={() => onRun(recipe.prompt)}
              className={className}
              data-testid={
                recipe.builtin
                  ? `chat-recipe-builtin-${recipe.id}`
                  : `chat-recipe-custom-${recipe.id}`
              }
            />
          );
        })}
      </div>
    </div>
  );
}
