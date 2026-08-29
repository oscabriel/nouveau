import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nouveau/ui/components/card";
import { Checkbox } from "@nouveau/ui/components/checkbox";
import { Input } from "@nouveau/ui/components/input";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

interface Todo {
	_id: Id<"todos">;
	completed: boolean;
	text: string;
}

const TodosRoute = () => {
	const [newTodoText, setNewTodoText] = useState("");

	const todos = useQuery(api.todos.getAll);
	const createTodo = useMutation(api.todos.create);
	const toggleTodo = useMutation(api.todos.toggle);
	const deleteTodo = useMutation(api.todos.deleteTodo);

	const handleAddTodo = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const text = newTodoText.trim();
		if (!text) {
			return;
		}
		await createTodo({ text });
		setNewTodoText("");
	};

	const handleToggleTodo = (id: Id<"todos">, currentCompleted: boolean) => {
		toggleTodo({ id, completed: !currentCompleted });
	};

	const handleDeleteTodo = (id: Id<"todos">) => {
		deleteTodo({ id });
	};

	let todoList: ReactNode;
	if (todos === undefined) {
		todoList = (
			<div className="flex justify-center py-4">
				<Loader2 className="h-6 w-6 animate-spin" />
			</div>
		);
	} else if (todos.length === 0) {
		todoList = <p className="py-4 text-center">No todos yet. Add one above!</p>;
	} else {
		todoList = (
			<ul className="space-y-2">
				{todos.map((todo: Todo) => (
					<li
						key={todo._id}
						className="flex items-center justify-between rounded-md border p-2"
					>
						<div className="flex items-center space-x-2">
							<Checkbox
								checked={todo.completed}
								onCheckedChange={() =>
									handleToggleTodo(todo._id, todo.completed)
								}
								id={`todo-${todo._id}`}
							/>
							<label
								htmlFor={`todo-${todo._id}`}
								className={`${todo.completed ? "text-muted-foreground line-through" : ""}`}
							>
								{todo.text}
							</label>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => handleDeleteTodo(todo._id)}
							aria-label="Delete todo"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</li>
				))}
			</ul>
		);
	}

	return (
		<div className="mx-auto w-full max-w-md py-10">
			<Card>
				<CardHeader>
					<CardTitle>Todo List</CardTitle>
					<CardDescription>Manage your tasks efficiently</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={handleAddTodo}
						className="mb-6 flex items-center space-x-2"
					>
						<Input
							value={newTodoText}
							onChange={(e) => setNewTodoText(e.target.value)}
							placeholder="Add a new task..."
						/>
						<Button type="submit" disabled={!newTodoText.trim()}>
							Add
						</Button>
					</form>
					{todoList}
				</CardContent>
			</Card>
		</div>
	);
};

export const Route = createFileRoute("/todos")({
	component: TodosRoute,
});
