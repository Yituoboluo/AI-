export const activeProjects = projects => projects.filter(project => !project.deletedAt);

export function reconcileLifecycle(local, remote, completed = false) {
  const keepLocalContent = local.pendingCloud === true;
  return {...local, serverVersion:remote.serverVersion,
    ...(completed ? {deletedAt:remote.deletedAt, pendingTrash:false} : {}),
    ...(keepLocalContent ? {} : {draft:remote.draft, name:remote.name, thumbnail:remote.thumbnail}),
    pendingCloud:keepLocalContent};
}

// Only retire the original, recognizable demo fixtures; user work stays intact.
export function isLegacyDemo(project) {
  const draft = project.draft;
  if (project.demoRetired || project.deletedAt) return false;
  if (project.name === '秋日好物上新' && draft.isExample && draft.productName === '轻量随行保温杯') return true;
  return ['MVP保存验证', '我的第一份创作'].includes(project.name)
    && !draft.productName && !draft.sellingPoint && !draft.headline && !draft.imageData;
}
