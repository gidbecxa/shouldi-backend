import { IsIn } from "class-validator";

export class ShareDto {
  @IsIn(["image", "link", "copy"])
  share_type!: "image" | "link" | "copy";
}
