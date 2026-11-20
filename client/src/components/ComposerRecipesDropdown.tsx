import { BookOpen, CircleCheck, GitPullRequest, MessageSquare, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BUILTIN_CHAT_RECIPE_IDS } from '@baguette/shared/session-chat-recipes.js';
import LightChipDropdown from './LightChipDropdown.jsx';

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

type ComposerRecipesDropdownProps = {
  recipes: ChatRecipe[];
  disabled?: boolean;
  onSelect: (prompt: string) => void;
};

export default function ComposerRecipesDropdown({
  recipes,
  disabled = false,
  onSelect,
}: ComposerRecipesDropdownProps) {
  if (!recipes.length) return null;

  const options = recipes.map((recipe) => {
    const Icon = recipe.builtin ? BUILTIN_RECIPE_ICONS[recipe.id] : Sparkles;
    return {
      value: recipe.id,
      label: recipe.label,
      description: recipe.description || undefined,
      title: recipe.description || recipe.label,
      icon: <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />,
    };
  });

  return (
    <div data-testid="composer-recipes-dropdown">
      <LightChipDropdown
        layout="list"
        value=""
        onChange={(id) => {
          const recipe = recipes.find((r) => r.id === id);
          if (recipe) onSelect(recipe.prompt);
        }}
        options={options}
        disabled={disabled}
        selectedDisplay={{
          icon: <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden />,
          content: <span className="truncate font-medium">Recipes</span>,
        }}
        ariaLabel="Recipes"
        triggerAriaLabel="Recipes"
        shrinkableTrigger
        triggerClassName="gap-1.5 rounded-md border border-line/80 bg-control/30 px-2 py-1 text-xs text-secondary hover:text-heading hover:border-faint hover:bg-control/60 transition-colors !h-auto min-h-0"
        placement="bottom-start"
      />
    </div>
  );
}
