import { IsInt, Max, Min } from "class-validator";

export class UpdateTimezoneDto {
  @IsInt()
  @Min(-840)
  @Max(840)
  timezone_offset!: number; // UTC offset in minutes
}
