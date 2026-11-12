import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'exclaim' })
export class ExclaimPipe implements PipeTransform {
  transform(value: string, times?: number): string {
    return value + '!'.repeat(times || 1);
  }
}
