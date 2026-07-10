import type { ProjectFileOut } from "../../lib/workspace";

export interface TreeNode {
  name: string;
  path: string;
  file?: ProjectFileOut;
  children: TreeNode[];
}

export function buildTree(files: ProjectFileOut[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  const map = new Map<string, TreeNode>([["", root]]);

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const segments = f.path.split("/");
    let parentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join("/");
      const isLast = i === segments.length - 1;
      let node = map.get(path);
      if (!node) {
        node = { name: segments[i], path, children: [], file: isLast ? f : undefined };
        map.set(path, node);
        map.get(parentPath)!.children.push(node);
      } else if (isLast) {
        node.file = f;
      }
      parentPath = path;
    }
  }

  sortChildren(root);
  return root.children;
}

function sortChildren(node: TreeNode) {
  node.children.sort((a, b) => {
    const aIsFolder = a.file?.type === "folder" || (!a.file && a.children.length > 0);
    const bIsFolder = b.file?.type === "folder" || (!b.file && b.children.length > 0);
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortChildren);
}
