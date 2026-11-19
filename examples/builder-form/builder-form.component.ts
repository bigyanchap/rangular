import { Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';

@Component({
  selector: 'app-builder-form',
  templateUrl: './builder-form.component.html',
})
export class BuilderFormComponent {
  signupForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    city: 'Salem',
    aliases: this.fb.array([
      ['', Validators.required],
    ]),
  });
  summary = '';

  constructor(private fb: FormBuilder) {}

  save() {
    this.summary = JSON.stringify(this.signupForm.value);
  }
}
