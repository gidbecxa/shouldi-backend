import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from "class-validator";

const categories = ["Life", "Love", "Career", "Money", "Health", "Fun", "Other"] as const;

export type Category = (typeof categories)[number];

export class CreateQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  text!: string;

  @IsIn(categories)
  category!: Category;

  @IsInt()
  @IsIn([1, 6, 24, 72])
  @Min(1)
  duration_hours!: 1 | 6 | 24 | 72;
}
